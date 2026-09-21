const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, env, { error: error.message }, error.status);
      }
      console.error("Unhandled API error", error);
      return json(request, env, { error: "Unexpected server error." }, 500);
    }
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/api/health") {
    return json(request, env, { ok: true, service: "xmas-wishlist-api" });
  }

  if (method === "GET" && path === "/api/members/public") {
    return publicMembers(request, env);
  }

  if (method === "POST" && path === "/api/setup") {
    return setupMember(request, env);
  }

  if (method === "POST" && path === "/api/login") {
    return login(request, env);
  }

  if (method === "POST" && path === "/api/logout") {
    return logout(request, env);
  }

  if (method === "GET" && path === "/api/me") {
    return me(request, env);
  }

  if (method === "GET" && path === "/api/home") {
    return home(request, env);
  }

  if (method === "GET" && path === "/api/shopping") {
    return shopping(request, env);
  }

  if (method === "GET" && path === "/api/admin/members") {
    return adminMembers(request, env);
  }

  if (method === "POST" && path === "/api/admin/members") {
    return adminAddMember(request, env);
  }

  let match = path.match(/^\/api\/wishlists\/([a-z0-9-]+)$/);
  if (match && method === "GET") {
    return wishlist(request, env, match[1]);
  }

  match = path.match(/^\/api\/wishlists\/([a-z0-9-]+)\/viewed$/);
  if (match && method === "POST") {
    return markViewed(request, env, match[1]);
  }

  if (method === "POST" && path === "/api/wishes") {
    return addWish(request, env);
  }

  match = path.match(/^\/api\/wishes\/(\d+)$/);
  if (match && method === "PATCH") {
    return editWish(request, env, Number(match[1]));
  }
  if (match && method === "DELETE") {
    return deleteWish(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/wishes\/(\d+)\/(reserve|purchase|release)$/);
  if (match && method === "POST") {
    const id = Number(match[1]);
    if (match[2] === "reserve") return reserveWish(request, env, id);
    if (match[2] === "purchase") return purchaseWish(request, env, id);
    return releaseWish(request, env, id);
  }

  match = path.match(/^\/api\/admin\/members\/(\d+)\/(invite|reset-access)$/);
  if (match && method === "POST") {
    return issueSetupCode(request, env, Number(match[1]), match[2] === "reset-access");
  }

  match = path.match(/^\/api\/admin\/members\/(\d+)$/);
  if (match && method === "PATCH") {
    return adminUpdateMember(request, env, Number(match[1]));
  }

  throw new HttpError(404, "Not found.");
}

async function publicMembers(request, env) {
  const rows = await env.DB.prepare(`
    SELECT
      id,
      member_key,
      display_name,
      avatar_asset,
      sort_order,
      CASE
        WHEN password_hash IS NOT NULL THEN 'ready'
        WHEN member_key = 'ub' THEN 'setup'
        WHEN setup_code_hash IS NOT NULL THEN 'setup'
        ELSE 'awaiting-invite'
      END AS setup_state
    FROM members
    WHERE active = 1
    ORDER BY sort_order, display_name
  `).all();

  return json(request, env, { members: rows.results || [] });
}

async function setupMember(request, env) {
  const body = await readJson(request);
  const memberKey = cleanKey(body.memberKey);
  const setupCode = String(body.setupCode || "").trim();
  const password = String(body.password || "");

  validatePassword(password);
  if (!setupCode) throw new HttpError(400, "Enter your setup code.");

  const member = await env.DB.prepare(`
    SELECT * FROM members WHERE member_key = ? AND active = 1
  `).bind(memberKey).first();

  if (!member) throw new HttpError(404, "Family member not found.");
  if (member.password_hash) throw new HttpError(409, "This account has already been set up.");

  let codeValid = false;

  if (member.member_key === "ub" && !member.setup_code_hash) {
    if (!env.BOOTSTRAP_ADMIN_CODE) {
      throw new HttpError(503, "Admin bootstrap has not been configured yet.");
    }
    codeValid = await safeTextEqual(setupCode, String(env.BOOTSTRAP_ADMIN_CODE));
  } else if (member.setup_code_hash && member.setup_code_salt) {
    codeValid = await verifySecret(setupCode, member.setup_code_salt, member.setup_code_hash);
  } else {
    throw new HttpError(403, "No setup code has been issued for this account yet.");
  }

  if (!codeValid) throw new HttpError(401, "That setup code is not valid.");

  const passwordRecord = await createSecretHash(password);
  const timestamp = now();

  await env.DB.prepare(`
    UPDATE members
    SET password_salt = ?,
        password_hash = ?,
        setup_code_salt = NULL,
        setup_code_hash = NULL,
        setup_code_used_at = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(
    passwordRecord.salt,
    passwordRecord.hash,
    timestamp,
    timestamp,
    member.id
  ).run();

  const freshMember = await getMemberById(env, member.id);
  const session = await createSession(env, freshMember.id);

  return json(request, env, {
    token: session.token,
    member: publicSelf(freshMember)
  }, 201);
}

async function login(request, env) {
  const body = await readJson(request);
  const memberKey = cleanKey(body.memberKey);
  const password = String(body.password || "");

  const member = await env.DB.prepare(`
    SELECT * FROM members WHERE member_key = ? AND active = 1
  `).bind(memberKey).first();

  if (
    !member ||
    !member.password_hash ||
    !member.password_salt ||
    !(await verifySecret(password, member.password_salt, member.password_hash))
  ) {
    throw new HttpError(401, "Incorrect member or password.");
  }

  const session = await createSession(env, member.id);

  return json(request, env, {
    token: session.token,
    member: publicSelf(member)
  });
}

async function logout(request, env) {
  const auth = await requireAuth(request, env);

  await env.DB.prepare(`
    UPDATE sessions SET revoked_at = ? WHERE token_hash = ?
  `).bind(now(), auth.tokenHash).run();

  return json(request, env, { ok: true });
}

async function me(request, env) {
  const auth = await requireAuth(request, env);
  return json(request, env, { member: publicSelf(auth.member) });
}

async function home(request, env) {
  const auth = await requireAuth(request, env);

  const rows = await env.DB.prepare(`
    SELECT
      m.id,
      m.member_key,
      m.display_name,
      m.avatar_asset,
      m.sort_order,
      CASE
        WHEN m.id = ? THEN 0
        WHEN EXISTS (
          SELECT 1
          FROM wishes w
          WHERE w.owner_id = m.id
            AND w.active = 1
            AND w.created_at > COALESCE(
              (
                SELECT lv.last_viewed_at
                FROM list_views lv
                WHERE lv.viewer_id = ?
                  AND lv.owner_id = m.id
              ),
              '1970-01-01T00:00:00.000Z'
            )
        ) THEN 1
        ELSE 0
      END AS has_new
    FROM members m
    WHERE m.active = 1
    ORDER BY m.sort_order, m.display_name
  `).bind(auth.member.id, auth.member.id).all();

  return json(request, env, {
    currentUser: publicSelf(auth.member),
    members: (rows.results || []).map(row => ({
      id: row.id,
      memberKey: row.member_key,
      displayName: row.display_name,
      avatarAsset: row.avatar_asset,
      sortOrder: row.sort_order,
      isSelf: row.id === auth.member.id,
      hasNew: Boolean(row.has_new)
    }))
  });
}

async function wishlist(request, env, memberKey) {
  const auth = await requireAuth(request, env);
  const owner = await env.DB.prepare(`
    SELECT id, member_key, display_name, avatar_asset
    FROM members
    WHERE member_key = ? AND active = 1
  `).bind(memberKey).first();

  if (!owner) throw new HttpError(404, "Wishlist owner not found.");

  let items;

  if (owner.id === auth.member.id) {
    const rows = await env.DB.prepare(`
      SELECT
        id, title, url, notes, barcode, product_image, image_source,
        version, created_at, updated_at
      FROM wishes
      WHERE owner_id = ? AND active = 1
      ORDER BY created_at DESC, id DESC
    `).bind(owner.id).all();

    // Deliberately no claim join and no availability field for the recipient.
    items = (rows.results || []).map(row => ({
      id: row.id,
      title: row.title,
      url: row.url,
      notes: row.notes,
      barcode: row.barcode,
      productImage: row.product_image,
      imageSource: row.image_source,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } else {
    const rows = await env.DB.prepare(`
      SELECT
        w.id, w.title, w.url, w.notes, w.barcode, w.product_image, w.image_source,
        w.version, w.created_at, w.updated_at,
        CASE WHEN c.id IS NULL THEN 'available' ELSE 'taken' END AS availability
      FROM wishes w
      LEFT JOIN claims c
        ON c.wish_id = w.id
       AND c.status IN ('reserved','purchased')
      WHERE w.owner_id = ? AND w.active = 1
      ORDER BY w.created_at DESC, w.id DESC
    `).bind(owner.id).all();

    // Deliberately never return claimant identity.
    items = (rows.results || []).map(row => ({
      id: row.id,
      title: row.title,
      url: row.url,
      notes: row.notes,
      barcode: row.barcode,
      productImage: row.product_image,
      imageSource: row.image_source,
      version: row.version,
      availability: row.availability,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  return json(request, env, {
    owner: {
      id: owner.id,
      memberKey: owner.member_key,
      displayName: owner.display_name,
      avatarAsset: owner.avatar_asset
    },
    isOwner: owner.id === auth.member.id,
    items
  });
}

async function markViewed(request, env, memberKey) {
  const auth = await requireAuth(request, env);

  const owner = await env.DB.prepare(`
    SELECT id FROM members WHERE member_key = ? AND active = 1
  `).bind(memberKey).first();

  if (!owner) throw new HttpError(404, "Wishlist owner not found.");

  if (owner.id !== auth.member.id) {
    await env.DB.prepare(`
      INSERT INTO list_views (viewer_id, owner_id, last_viewed_at)
      VALUES (?, ?, ?)
      ON CONFLICT(viewer_id, owner_id)
      DO UPDATE SET last_viewed_at = excluded.last_viewed_at
    `).bind(auth.member.id, owner.id, now()).run();
  }

  return json(request, env, { ok: true });
}

async function addWish(request, env) {
  const auth = await requireAuth(request, env);
  const body = await readJson(request);
  const wish = validateWishInput(body, true);
  const timestamp = now();

  const result = await env.DB.prepare(`
    INSERT INTO wishes (
      owner_id, title, url, notes, barcode, product_image, image_source,
      version, active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
  `).bind(
    auth.member.id,
    wish.title,
    wish.url,
    wish.notes,
    wish.barcode,
    wish.productImage,
    wish.imageSource,
    timestamp,
    timestamp
  ).run();

  return json(request, env, {
    id: result.meta?.last_row_id,
    ok: true
  }, 201);
}

async function editWish(request, env, wishId) {
  const auth = await requireAuth(request, env);
  const current = await env.DB.prepare(`
    SELECT * FROM wishes WHERE id = ? AND active = 1
  `).bind(wishId).first();

  if (!current) throw new HttpError(404, "Wish not found.");
  if (current.owner_id !== auth.member.id) throw new HttpError(403, "You can edit only your own wishes.");

  const body = await readJson(request);
  const merged = validateWishInput({
    title: body.title ?? current.title,
    url: body.url ?? current.url,
    notes: body.notes ?? current.notes,
    barcode: body.barcode ?? current.barcode,
    productImage: body.productImage ?? current.product_image,
    imageSource: body.imageSource ?? current.image_source
  }, true);

  await env.DB.prepare(`
    UPDATE wishes
    SET title = ?,
        url = ?,
        notes = ?,
        barcode = ?,
        product_image = ?,
        image_source = ?,
        version = version + 1,
        updated_at = ?
    WHERE id = ?
  `).bind(
    merged.title,
    merged.url,
    merged.notes,
    merged.barcode,
    merged.productImage,
    merged.imageSource,
    now(),
    wishId
  ).run();

  return json(request, env, { ok: true });
}

async function deleteWish(request, env, wishId) {
  const auth = await requireAuth(request, env);
  const wish = await env.DB.prepare(`
    SELECT id, owner_id, active FROM wishes WHERE id = ?
  `).bind(wishId).first();

  if (!wish || !wish.active) throw new HttpError(404, "Wish not found.");
  if (wish.owner_id !== auth.member.id) throw new HttpError(403, "You can remove only your own wishes.");

  const timestamp = now();
  await env.DB.prepare(`
    UPDATE wishes
    SET active = 0, deleted_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(timestamp, timestamp, wishId).run();

  return json(request, env, { ok: true });
}

async function reserveWish(request, env, wishId) {
  const auth = await requireAuth(request, env);

  const wish = await env.DB.prepare(`
    SELECT w.*, m.active AS owner_active
    FROM wishes w
    JOIN members m ON m.id = w.owner_id
    WHERE w.id = ?
  `).bind(wishId).first();

  if (!wish || !wish.active || !wish.owner_active) {
    throw new HttpError(404, "That wish is no longer available.");
  }
  if (wish.owner_id === auth.member.id) {
    throw new HttpError(403, "You cannot reserve a gift from your own wishlist.");
  }

  const timestamp = now();

  try {
    await env.DB.prepare(`
      INSERT INTO claims (
        wish_id, claimed_by, status,
        wish_version_at_claim,
        snapshot_title, snapshot_url, snapshot_notes,
        created_at, updated_at
      )
      VALUES (?, ?, 'reserved', ?, ?, ?, ?, ?, ?)
    `).bind(
      wish.id,
      auth.member.id,
      wish.version,
      wish.title,
      wish.url,
      wish.notes,
      timestamp,
      timestamp
    ).run();
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("UNIQUE") || message.includes("constraint")) {
      throw new HttpError(409, "This gift was just taken.");
    }
    throw error;
  }

  return json(request, env, { ok: true, status: "reserved" }, 201);
}

async function purchaseWish(request, env, wishId) {
  const auth = await requireAuth(request, env);

  const claim = await env.DB.prepare(`
    SELECT id, status
    FROM claims
    WHERE wish_id = ?
      AND claimed_by = ?
      AND status IN ('reserved','purchased')
  `).bind(wishId, auth.member.id).first();

  if (!claim) throw new HttpError(404, "This gift is not in your shopping list.");
  if (claim.status === "purchased") {
    return json(request, env, { ok: true, status: "purchased" });
  }

  await env.DB.prepare(`
    UPDATE claims
    SET status = 'purchased', updated_at = ?
    WHERE id = ?
  `).bind(now(), claim.id).run();

  return json(request, env, { ok: true, status: "purchased" });
}

async function releaseWish(request, env, wishId) {
  const auth = await requireAuth(request, env);

  const claim = await env.DB.prepare(`
    SELECT id, status
    FROM claims
    WHERE wish_id = ?
      AND claimed_by = ?
      AND status IN ('reserved','purchased')
  `).bind(wishId, auth.member.id).first();

  if (!claim) throw new HttpError(404, "This gift is not in your shopping list.");
  if (claim.status === "purchased") {
    throw new HttpError(409, "Purchased gifts cannot be released in this version.");
  }

  const timestamp = now();
  await env.DB.prepare(`
    UPDATE claims
    SET status = 'released', released_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(timestamp, timestamp, claim.id).run();

  return json(request, env, { ok: true, status: "released" });
}

async function shopping(request, env) {
  const auth = await requireAuth(request, env);

  const rows = await env.DB.prepare(`
    SELECT
      c.id AS claim_id,
      c.wish_id,
      c.status,
      c.wish_version_at_claim,
      c.snapshot_title,
      c.snapshot_url,
      c.snapshot_notes,
      c.created_at AS claimed_at,
      c.updated_at AS claim_updated_at,

      w.title AS current_title,
      w.url AS current_url,
      w.notes AS current_notes,
      w.version AS current_version,
      w.active AS wish_active,

      m.member_key AS owner_key,
      m.display_name AS owner_name,
      m.active AS owner_active
    FROM claims c
    JOIN wishes w ON w.id = c.wish_id
    JOIN members m ON m.id = w.owner_id
    WHERE c.claimed_by = ?
      AND c.status IN ('reserved','purchased')
    ORDER BY m.sort_order, c.updated_at DESC
  `).bind(auth.member.id).all();

  const items = (rows.results || []).map(row => ({
    claimId: row.claim_id,
    wishId: row.wish_id,
    status: row.status,
    owner: {
      memberKey: row.owner_key,
      displayName: row.owner_name,
      active: Boolean(row.owner_active)
    },
    original: {
      title: row.snapshot_title,
      url: row.snapshot_url,
      notes: row.snapshot_notes,
      version: row.wish_version_at_claim
    },
    current: {
      title: row.current_title,
      url: row.current_url,
      notes: row.current_notes,
      version: row.current_version
    },
    changed: row.current_version !== row.wish_version_at_claim,
    removed: !Boolean(row.wish_active),
    claimedAt: row.claimed_at,
    updatedAt: row.claim_updated_at
  }));

  return json(request, env, { items });
}

async function adminMembers(request, env) {
  const auth = await requireAdmin(request, env);

  const rows = await env.DB.prepare(`
    SELECT
      id, member_key, display_name, avatar_asset, sort_order, role, active,
      CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS setup_complete,
      CASE WHEN setup_code_hash IS NULL THEN 0 ELSE 1 END AS invite_pending,
      created_at, updated_at
    FROM members
    ORDER BY sort_order, display_name
  `).all();

  return json(request, env, {
    currentUser: publicSelf(auth.member),
    members: (rows.results || []).map(row => ({
      id: row.id,
      memberKey: row.member_key,
      displayName: row.display_name,
      avatarAsset: row.avatar_asset,
      sortOrder: row.sort_order,
      role: row.role,
      active: Boolean(row.active),
      setupComplete: Boolean(row.setup_complete),
      invitePending: Boolean(row.invite_pending),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  });
}

async function adminAddMember(request, env) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const displayName = cleanText(body.displayName, 60);
  const memberKey = cleanKey(body.memberKey || slugify(displayName));

  if (!displayName) throw new HttpError(400, "Enter a display name.");
  if (!memberKey) throw new HttpError(400, "Enter a valid member key.");

  const max = await env.DB.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM members
  `).first();

  const timestamp = now();

  try {
    const result = await env.DB.prepare(`
      INSERT INTO members (
        member_key, display_name, sort_order, role, active, created_at, updated_at
      )
      VALUES (?, ?, ?, 'member', 1, ?, ?)
    `).bind(
      memberKey,
      displayName,
      Number(max?.max_sort || 0) + 1,
      timestamp,
      timestamp
    ).run();

    const memberId = result.meta?.last_row_id;
    const invite = await setSetupCode(env, memberId, true);

    return json(request, env, {
      id: memberId,
      memberKey,
      displayName,
      setupCode: invite.code
    }, 201);
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("UNIQUE") || message.includes("constraint")) {
      throw new HttpError(409, "That member key is already in use.");
    }
    throw error;
  }
}

async function issueSetupCode(request, env, memberId, resetAccess) {
  const auth = await requireAdmin(request, env);
  const member = await getMemberById(env, memberId);

  if (!member) throw new HttpError(404, "Family member not found.");
  if (!member.active) throw new HttpError(409, "Reactivate this member before issuing access.");
  if (member.id === auth.member.id && resetAccess) {
    throw new HttpError(409, "Use another signed-in admin session before resetting your own access.");
  }
  if (member.password_hash && !resetAccess) {
    throw new HttpError(409, "This member is already set up. Use reset access instead.");
  }

  const invite = await setSetupCode(env, member.id, resetAccess);

  return json(request, env, {
    ok: true,
    member: { id: member.id, memberKey: member.member_key, displayName: member.display_name },
    setupCode: invite.code
  });
}

async function adminUpdateMember(request, env, memberId) {
  const auth = await requireAdmin(request, env);
  const member = await getMemberById(env, memberId);
  if (!member) throw new HttpError(404, "Family member not found.");

  const body = await readJson(request);

  if (Object.prototype.hasOwnProperty.call(body, "active")) {
    const active = Boolean(body.active);

    if (!active && member.id === auth.member.id) {
      throw new HttpError(409, "You cannot deactivate the admin account you are currently using.");
    }

    const timestamp = now();

    if (active) {
      await env.DB.prepare(`
        UPDATE members SET active = 1, updated_at = ? WHERE id = ?
      `).bind(timestamp, member.id).run();
    } else {
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE members SET active = 0, updated_at = ? WHERE id = ?
        `).bind(timestamp, member.id),

        env.DB.prepare(`
          UPDATE sessions
          SET revoked_at = ?
          WHERE member_id = ? AND revoked_at IS NULL
        `).bind(timestamp, member.id),

        env.DB.prepare(`
          UPDATE claims
          SET status = 'released', released_at = ?, updated_at = ?
          WHERE claimed_by = ? AND status = 'reserved'
        `).bind(timestamp, timestamp, member.id)
      ]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
    const displayName = cleanText(body.displayName, 60);
    if (!displayName) throw new HttpError(400, "Display name cannot be empty.");
    await env.DB.prepare(`
      UPDATE members SET display_name = ?, updated_at = ? WHERE id = ?
    `).bind(displayName, now(), member.id).run();
  }

  if (Object.prototype.hasOwnProperty.call(body, "sortOrder")) {
    const sortOrder = Number(body.sortOrder);
    if (!Number.isInteger(sortOrder)) throw new HttpError(400, "Sort order must be an integer.");
    await env.DB.prepare(`
      UPDATE members SET sort_order = ?, updated_at = ? WHERE id = ?
    `).bind(sortOrder, now(), member.id).run();
  }

  if (Object.prototype.hasOwnProperty.call(body, "avatarAsset")) {
    const avatarAsset = nullableText(body.avatarAsset, 500);
    await env.DB.prepare(`
      UPDATE members SET avatar_asset = ?, updated_at = ? WHERE id = ?
    `).bind(avatarAsset, now(), member.id).run();
  }

  return json(request, env, { ok: true });
}

async function setSetupCode(env, memberId, resetAccess) {
  const code = randomNumericCode();
  const record = await createSecretHash(code);
  const timestamp = now();

  const statements = [
    env.DB.prepare(`
      UPDATE members
      SET setup_code_salt = ?,
          setup_code_hash = ?,
          setup_code_used_at = NULL,
          updated_at = ?
          ${resetAccess ? ", password_salt = NULL, password_hash = NULL" : ""}
      WHERE id = ?
    `).bind(record.salt, record.hash, timestamp, memberId)
  ];

  if (resetAccess) {
    statements.push(
      env.DB.prepare(`
        UPDATE sessions
        SET revoked_at = ?
        WHERE member_id = ? AND revoked_at IS NULL
      `).bind(timestamp, memberId)
    );
  }

  await env.DB.batch(statements);
  return { code };
}

async function requireAdmin(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.member.role !== "admin") throw new HttpError(403, "Admin access required.");
  return auth;
}

async function requireAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "Sign in required.");

  const rawToken = match[1].trim();
  const tokenHash = await sha256Text(rawToken);
  const timestamp = now();

  const row = await env.DB.prepare(`
    SELECT
      m.id,
      m.member_key,
      m.display_name,
      m.avatar_asset,
      m.sort_order,
      m.role,
      m.active,
      s.id AS session_id,
      s.expires_at
    FROM sessions s
    JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND m.active = 1
  `).bind(tokenHash, timestamp).first();

  if (!row) throw new HttpError(401, "Your session has expired. Sign in again.");

  return { member: row, tokenHash };
}

async function createSession(env, memberId) {
  const token = base64Url(randomBytes(32));
  const tokenHash = await sha256Text(token);
  const createdAt = now();
  const days = Math.max(1, Number(env.SESSION_DAYS || 180));
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

  await env.DB.prepare(`
    INSERT INTO sessions (
      member_id, token_hash, created_at, last_seen_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).bind(memberId, tokenHash, createdAt, createdAt, expiresAt).run();

  return { token, expiresAt };
}

async function getMemberById(env, memberId) {
  return env.DB.prepare(`
    SELECT * FROM members WHERE id = ?
  `).bind(memberId).first();
}

function publicSelf(member) {
  return {
    id: member.id,
    memberKey: member.member_key,
    displayName: member.display_name,
    avatarAsset: member.avatar_asset,
    role: member.role
  };
}

function validateWishInput(body, requireTitle) {
  const title = cleanText(body.title, 200);
  if (requireTitle && !title) throw new HttpError(400, "Enter a gift name.");

  const imageSource = nullableText(body.imageSource, 30);
  if (imageSource && !["catalog", "user-photo", "none"].includes(imageSource)) {
    throw new HttpError(400, "Invalid image source.");
  }

  return {
    title,
    url: validateUrl(body.url),
    notes: nullableText(body.notes, 1200),
    barcode: nullableText(body.barcode, 80),
    productImage: validateUrl(body.productImage),
    imageSource
  };
}

function validateUrl(value) {
  const text = nullableText(value, 2000);
  if (!text) return null;

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new HttpError(400, "Use a valid web address.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new HttpError(400, "Only http and https links are allowed.");
  }

  return parsed.toString();
}

function validatePassword(password) {
  if (password.length < 6) {
    throw new HttpError(400, "Choose a password with at least 6 characters.");
  }
  if (password.length > 128) {
    throw new HttpError(400, "Password is too long.");
  }
}

function cleanKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(key)) {
    throw new HttpError(400, "Invalid member key.");
  }
  return key;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function nullableText(value, max) {
  const text = cleanText(value, max);
  return text || null;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}

async function createSecretHash(secret) {
  const saltBytes = randomBytes(16);
  const salt = base64Url(saltBytes);
  const hash = await pbkdf2(secret, saltBytes);
  return { salt, hash };
}

async function verifySecret(secret, saltText, expectedHash) {
  try {
    const salt = fromBase64Url(saltText);
    const actualHash = await pbkdf2(secret, salt);
    return safeStringEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}

async function pbkdf2(secret, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations: 210000
    },
    keyMaterial,
    256
  );

  return base64Url(new Uint8Array(bits));
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(text)));
  return base64Url(new Uint8Array(digest));
}

async function safeTextEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256Text(a), sha256Text(b)]);
  return safeStringEqual(ha, hb);
}

function safeStringEqual(a, b) {
  const aa = encoder.encode(String(a));
  const bb = encoder.encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomNumericCode() {
  const bytes = randomBytes(4);
  const value = (
    ((bytes[0] << 24) >>> 0) +
    (bytes[1] << 16) +
    (bytes[2] << 8) +
    bytes[3]
  ) >>> 0;
  return String(10000000 + (value % 90000000));
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(text) {
  const normalized = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function now() {
  return new Date().toISOString();
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const configured = String(env.FRONTEND_ORIGIN || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);

  const localhost =
    origin &&
    (/^http:\/\/localhost(?::\d+)?$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin));

  const allowed = !origin || configured.includes(origin) || localhost;

  const headers = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };

  if (origin && allowed) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env)
    }
  });
}