const crypto = require('crypto');

const millis = (v) => v == null ? null : new Date(v).getTime();
const num = (v) => v == null ? null : Number(v);
const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));

function workFromRow(row) {
  if (!row) return null;
  const p = row.payload || {};
  return {
    ...p,
    id: row.id,
    title: row.title,
    duration: num(row.duration_seconds) || 0,
    video: row.video_url || p.video || null,
    poster: row.poster_url || p.poster || null,
    ownerId: row.owner_id || p.ownerId || null,
    organizationId: row.organization_id || p.organizationId || null,
    pilot: !!row.pilot,
    syncId: row.sync_id || p.syncId || null,
    updatedAt: millis(row.updated_at) || p.updatedAt || null,
  };
}

function productFromRow(row) {
  if (!row) return null;
  const p = row.payload || {};
  return {
    ...p,
    id: row.id,
    name: row.name,
    brand: row.brand || p.brand || null,
    category: row.category || p.category || null,
    sku: row.sku || p.sku || null,
    image: row.image_url || p.image || null,
    referencePrice: row.reference_price == null ? p.referencePrice : Number(row.reference_price),
    createdBy: row.created_by || p.createdBy || null,
    organizationId: row.organization_id || p.organizationId || null,
    updatedAt: millis(row.updated_at) || p.updatedAt || null,
  };
}

function trackHeadFromRow(row) {
  if (!row) return null;
  const p = row.payload || {};
  return {
    ...p,
    id: row.id,
    workId: row.work_id,
    type: row.type,
    authorId: row.author_id,
    organizationId: row.organization_id || p.organizationId || null,
    title: row.title,
    offset: Number(row.offset_seconds || 0),
    status: row.status,
    createdAt: millis(row.created_at) || p.createdAt || null,
    updatedAt: millis(row.updated_at) || p.updatedAt || null,
    scenes: [],
  };
}

function hydrateTrack(head, sceneRows, productRows) {
  if (!head) return null;
  const byScene = new Map();
  for (const row of sceneRows || []) {
    const p = row.payload || {};
    const scene = {
      ...p,
      id: row.scene_id,
      title: row.title || p.title || row.scene_id,
      start: Number(row.start_seconds || 0),
      end: Number(row.end_seconds || 0),
      thumb: p.thumb || null,
      products: [],
      _position: Number(row.position || 0),
    };
    byScene.set(scene.id, scene);
  }
  for (const row of productRows || []) {
    const p = row.payload || {};
    const scene = byScene.get(row.scene_id);
    if (!scene) continue;
    scene.products.push({
      ...p,
      id: row.product_id,
      match: row.match_type || p.match || 'exato',
      box: row.box || p.box || null,
      _position: Number(row.position || 0),
    });
  }
  head.scenes = [...byScene.values()]
    .sort((a,b) => a._position - b._position)
    .map((s) => ({ ...s, products: s.products.sort((a,b) => a._position - b._position).map(({_position,...x}) => x), _position: undefined }))
    .map(({_position,...s}) => s);
  return head;
}

async function readTrack(client, id, organizationId=null) {
  const h = organizationId
    ? await client.query('SELECT * FROM sceneshop_tracks WHERE id=$1 AND organization_id=$2', [id,organizationId])
    : await client.query('SELECT * FROM sceneshop_tracks WHERE id=$1', [id]);
  if (!h.rowCount) return null;
  const scenes = await client.query(
    'SELECT * FROM sceneshop_track_scenes WHERE track_id=$1 ORDER BY position,start_seconds', [id]
  );
  const products = await client.query(
    'SELECT * FROM sceneshop_scene_products WHERE track_id=$1 ORDER BY scene_id,position', [id]
  );
  return hydrateTrack(trackHeadFromRow(h.rows[0]), scenes.rows, products.rows);
}

async function writeTrackRows(client, track) {
  await client.query(
    `INSERT INTO sceneshop_tracks(id,work_id,type,author_id,organization_id,title,offset_seconds,status,created_at,payload,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
     ON CONFLICT(id) DO UPDATE SET
       work_id=EXCLUDED.work_id,type=EXCLUDED.type,author_id=EXCLUDED.author_id,organization_id=EXCLUDED.organization_id,title=EXCLUDED.title,
       offset_seconds=EXCLUDED.offset_seconds,status=EXCLUDED.status,payload=EXCLUDED.payload,updated_at=now()`,
    [track.id, track.workId, track.type || 'community', track.authorId || null, track.organizationId || null, track.title || track.id,
     Number(track.offset || 0), track.status || 'ativa', track.createdAt ? new Date(track.createdAt) : null, JSON.stringify(track)]
  );
  await client.query('DELETE FROM sceneshop_scene_products WHERE track_id=$1', [track.id]);
  await client.query('DELETE FROM sceneshop_track_scenes WHERE track_id=$1', [track.id]);
  for (let i=0;i<(track.scenes || []).length;i++) {
    const s = track.scenes[i];
    await client.query(
      `INSERT INTO sceneshop_track_scenes(track_id,scene_id,title,start_seconds,end_seconds,position,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [track.id, s.id, s.title || null, Number(s.start || 0), Number(s.end || 0), i, JSON.stringify(s)]
    );
    for (let j=0;j<(s.products || []).length;j++) {
      const p = s.products[j];
      await client.query(
        `INSERT INTO sceneshop_scene_products(track_id,scene_id,product_id,match_type,position,box,payload)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
        [track.id, s.id, p.id, p.match || 'exato', j, p.box ? JSON.stringify(p.box) : null, JSON.stringify(p)]
      );
    }
  }
}

// Normalização de texto sem acento, igual nos dois lados da comparação.
const FOLD_FROM = 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
const FOLD_TO   = 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn';
const foldText = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const SQL_FOLD = (expr) => `translate(lower(${expr}),'${FOLD_FROM}','${FOLD_TO}')`;

class PostgresContentRepository {
  constructor({ store }) { this.store = store; }

  async listWorks() {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT * FROM sceneshop_works ORDER BY title,id');
      return r.rows.map(workFromRow);
    });
  }

  async getWork(id) {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT * FROM sceneshop_works WHERE id=$1', [String(id)]);
      return r.rowCount ? workFromRow(r.rows[0]) : null;
    });
  }

  async listWorksByOwner(ownerId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT * FROM sceneshop_works WHERE owner_id=$1 ORDER BY updated_at DESC,id', [String(ownerId)]);
      return r.rows.map(workFromRow);
    });
  }

  async listWorksByOrganization(organizationId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT * FROM sceneshop_works WHERE organization_id=$1 ORDER BY updated_at DESC,id', [String(organizationId)]);
      return r.rows.map(workFromRow);
    });
  }

  async getWorkForOrganization(id, organizationId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT * FROM sceneshop_works WHERE id=$1 AND organization_id=$2', [String(id),String(organizationId)]);
      return r.rowCount ? workFromRow(r.rows[0]) : null;
    });
  }

  async createWork(work, partnerIds = []) {
    const w = { ...clone(work), syncId: work.syncId || `SYNC-${crypto.randomBytes(10).toString('hex').toUpperCase()}` };
    const committed = await this.store.atomicDomain(async (draft) => {
      draft.userWorks = draft.userWorks || {};
      draft.workPartners = draft.workPartners || {};
      draft.userWorks[w.id] = w;
      draft.workPartners[w.id] = [...partnerIds];
      return {
        snapshot: draft,
        topic: 'content.work.created', aggregateType: 'work', aggregateId: w.id,
        outboxPayload: { workId: w.id, ownerId: w.ownerId, syncId: w.syncId }, result: w,
        write: async (client) => {
          await client.query(
            `INSERT INTO sceneshop_works(id,title,duration_seconds,video_url,poster_url,owner_id,organization_id,pilot,sync_id,payload,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())`,
            [w.id,w.title,Number(w.duration||0),w.video||null,w.poster||null,w.ownerId||null,w.organizationId||null,!!w.pilot,w.syncId,JSON.stringify(w)]
          );
          for (const partnerId of partnerIds || []) {
            await client.query(
              `INSERT INTO sceneshop_work_partners(work_id,partner_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
              [w.id, partnerId]
            );
          }
          return { created: true, syncId: w.syncId };
        },
      };
    });
    return committed.result;
  }

  async listProducts() {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT * FROM sceneshop_products ORDER BY name,id');
      return r.rows.map(productFromRow);
    });
  }

  async searchPublicProducts(q) {
    const words=foldText(q).split(/\s+/).filter(Boolean);
    return this.store.readDomain(async (client) => {
      const params=[];
      const clauses=words.map((word,i)=>{ params.push(`%${word}%`); return `${SQL_FOLD("concat_ws(' ',name,brand,category,sku)")} LIKE $${i+1}`; });
      const sql=`SELECT * FROM sceneshop_products WHERE organization_id IS NULL ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''} ORDER BY name,id LIMIT 30`;
      const r=await client.query(sql,params); return r.rows.map(productFromRow);
    });
  }

  async getPublicProduct(id) {
    return this.store.readDomain(async (client) => {
      const r=await client.query('SELECT * FROM sceneshop_products WHERE id=$1 AND organization_id IS NULL',[String(id)]);
      return r.rowCount ? productFromRow(r.rows[0]) : null;
    });
  }

  async getProduct(id) {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT * FROM sceneshop_products WHERE id=$1', [String(id)]);
      return r.rowCount ? productFromRow(r.rows[0]) : null;
    });
  }

  async searchProducts(q, ownerId) {
    const words = foldText(q).split(/\s+/).filter(Boolean);
    return this.store.readDomain(async (client) => {
      const params = [ownerId || null];
      const clauses = words.map((word, i) => {
        params.push(`%${word}%`);
        const n = i + 2;
        return `${SQL_FOLD("concat_ws(' ',name,brand,category,sku)")} LIKE $${n}`;
      });
      const sql = `SELECT * FROM sceneshop_products ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
                   ORDER BY (created_by IS NOT DISTINCT FROM $1) DESC,name,id LIMIT 30`;
      const r = await client.query(sql, params);
      return r.rows.map(productFromRow);
    });
  }

  async listProductsByOwner(ownerId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT * FROM sceneshop_products WHERE created_by=$1 ORDER BY updated_at DESC,id', [String(ownerId)]);
      return r.rows.map(productFromRow);
    });
  }

  async listProductsByOrganization(organizationId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT * FROM sceneshop_products WHERE organization_id=$1 ORDER BY updated_at DESC,id', [String(organizationId)]);
      return r.rows.map(productFromRow);
    });
  }

  async searchProductsForOrganization(q, organizationId) {
    // Busca sem acento (paridade com o modo em memória) e produtos da organização primeiro:
    // (organization_id=$1) é NULL para produtos globais e NULL vem antes em DESC no PostgreSQL.
    const words=foldText(q).split(/\s+/).filter(Boolean);
    return this.store.readDomain(async (client) => {
      const params=[String(organizationId)];
      const clauses=words.map((word,i)=>{ params.push(`%${word}%`); return `${SQL_FOLD("concat_ws(' ',name,brand,category,sku)")} LIKE $${i+2}`; });
      const sql=`SELECT * FROM sceneshop_products WHERE (organization_id=$1 OR organization_id IS NULL) ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''} ORDER BY (organization_id IS NOT DISTINCT FROM $1) DESC,name,id LIMIT 30`;
      const r=await client.query(sql,params); return r.rows.map(productFromRow);
    });
  }

  async getProductForOrganization(id, organizationId, { allowGlobal=true } = {}) {
    return this.store.readDomain(async (client) => {
      const sql = allowGlobal
        ? 'SELECT * FROM sceneshop_products WHERE id=$1 AND (organization_id=$2 OR organization_id IS NULL)'
        : 'SELECT * FROM sceneshop_products WHERE id=$1 AND organization_id=$2';
      const r = await client.query(sql, [String(id),String(organizationId)]);
      return r.rowCount ? productFromRow(r.rows[0]) : null;
    });
  }

  async createProduct(product) {
    const p = clone(product);
    const committed = await this.store.atomicDomain(async (draft) => {
      draft.userProducts = draft.userProducts || {};
      draft.userProducts[p.id] = p;
      return {
        snapshot: draft,
        topic: 'content.product.created', aggregateType: 'product', aggregateId: p.id,
        outboxPayload: { productId: p.id, ownerId: p.createdBy || null }, result: p,
        write: async (client) => {
          await client.query(
            `INSERT INTO sceneshop_products(id,name,brand,category,sku,image_url,reference_price,created_by,organization_id,payload,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())`,
            [p.id,p.name,p.brand||null,p.category||null,p.sku||null,p.image||null,
             p.referencePrice==null?null:Number(p.referencePrice),p.createdBy||null,p.organizationId||null,JSON.stringify(p)]
          );
          return { created: true };
        },
      };
    });
    return committed.result;
  }

  async updateProduct(product) {
    const p = clone(product);
    const committed = await this.store.atomicDomain(async (draft) => {
      draft.userProducts = draft.userProducts || {};
      draft.userProducts[p.id] = p;
      return {
        snapshot: draft,
        topic: 'content.product.updated', aggregateType: 'product', aggregateId: p.id,
        outboxPayload: { productId: p.id, ownerId: p.createdBy || null }, result: p,
        write: async (client) => {
          const r = await client.query(
            `UPDATE sceneshop_products SET name=$2,brand=$3,category=$4,sku=$5,image_url=$6,reference_price=$7,
                    created_by=$8,organization_id=$9,payload=$10::jsonb,updated_at=now() WHERE id=$1 AND organization_id=$9`,
            [p.id,p.name,p.brand||null,p.category||null,p.sku||null,p.image||null,
             p.referencePrice==null?null:Number(p.referencePrice),p.createdBy||null,p.organizationId||null,JSON.stringify(p)]
          );
          if (!r.rowCount) { const e = new Error('Produto não encontrado no PostgreSQL.'); e.code='CONTENT_NOT_FOUND'; throw e; }
          return { updated: true };
        },
      };
    });
    return committed.result;
  }

  async getTrack(id) {
    return this.store.readDomain((client) => readTrack(client, String(id)));
  }

  async getTrackForOrganization(id, organizationId) {
    return this.store.readDomain((client) => readTrack(client, String(id), String(organizationId)));
  }

  async listTracksByOrganization(organizationId, workId=null) {
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT id FROM sceneshop_tracks WHERE organization_id=$1 ${workId ? 'AND work_id=$2' : ''} ORDER BY created_at DESC,id`,
        workId ? [String(organizationId),String(workId)] : [String(organizationId)]
      );
      const out=[]; for (const row of r.rows) out.push(await readTrack(client,row.id,String(organizationId))); return out;
    });
  }

  async listTracksByWork(workId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query('SELECT id FROM sceneshop_tracks WHERE work_id=$1 ORDER BY created_at,id', [String(workId)]);
      const out=[]; for (const row of r.rows) out.push(await readTrack(client,row.id)); return out;
    });
  }

  async listTracksByAuthor(authorId, workId=null) {
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT id FROM sceneshop_tracks WHERE author_id=$1 ${workId ? 'AND work_id=$2' : ''} ORDER BY created_at DESC,id`,
        workId ? [String(authorId),String(workId)] : [String(authorId)]
      );
      const out=[]; for (const row of r.rows) out.push(await readTrack(client,row.id)); return out;
    });
  }

  async listOfficialProductIdsByOrganization(organizationId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT DISTINCT product_id FROM (
           SELECT sp.product_id FROM sceneshop_tracks t
             JOIN sceneshop_scene_products sp ON sp.track_id=t.id
            WHERE t.organization_id=$1 AND t.type='official' AND t.status<>'removida'
           UNION
           SELECT p.id AS product_id FROM sceneshop_products p WHERE p.organization_id=$1
         ) q ORDER BY product_id`, [String(organizationId)]
      );
      return r.rows.map((row)=>row.product_id);
    });
  }

  async organizationOwnsOfficialProduct(organizationId, productId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT 1 FROM sceneshop_products p WHERE p.id=$2 AND p.organization_id=$1
         UNION ALL
         SELECT 1 FROM sceneshop_tracks t
          JOIN sceneshop_scene_products sp ON sp.track_id=t.id
         WHERE t.organization_id=$1 AND t.type='official' AND t.status<>'removida' AND sp.product_id=$2
         LIMIT 1`, [String(organizationId),String(productId)]
      );
      return !!r.rowCount;
    });
  }

  async listOfficialProductIdsByAuthor(authorId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT DISTINCT product_id FROM (
           SELECT sp.product_id
             FROM sceneshop_tracks t
             JOIN sceneshop_scene_products sp ON sp.track_id=t.id
            WHERE t.author_id=$1 AND t.type='official' AND t.status<>'removida'
           UNION
           SELECT p.id AS product_id
             FROM sceneshop_products p
            WHERE p.created_by=$1
         ) q
         ORDER BY product_id`,
        [String(authorId)]
      );
      return r.rows.map((row) => row.product_id);
    });
  }

  async authorOwnsOfficialProduct(authorId, productId) {
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT 1
           FROM sceneshop_products p
          WHERE p.id=$2 AND p.created_by=$1
         UNION ALL
         SELECT 1
           FROM sceneshop_tracks t
           JOIN sceneshop_scene_products sp ON sp.track_id=t.id
          WHERE t.author_id=$1 AND t.type='official' AND t.status<>'removida' AND sp.product_id=$2
         LIMIT 1`,
        [String(authorId), String(productId)]
      );
      return !!r.rowCount;
    });
  }

  async saveTrack(track, topic='content.track.saved') {
    const t = clone(track);
    const committed = await this.store.atomicDomain(async (draft) => {
      draft.tracks = draft.tracks || {};
      draft.tracks[t.id] = t;
      return {
        snapshot: draft,
        topic, aggregateType:'track', aggregateId:t.id,
        outboxPayload:{ trackId:t.id, workId:t.workId, authorId:t.authorId, status:t.status }, result:t,
        write: async (client) => {
          if (t.organizationId) {
            const workCheck = await client.query('SELECT organization_id FROM sceneshop_works WHERE id=$1',[t.workId]);
            // Linha da comunidade: trilha "community" pode existir sobre obra de outra organização
            // (como legendas). Trilha oficial continua presa à organização dona da obra.
            const community = t.type === 'community';
            const workOrg = workCheck.rowCount ? workCheck.rows[0].organization_id : null;
            if (!workCheck.rowCount || (!community && workOrg !== t.organizationId)) { const e=new Error('Obra de outra organização.'); e.code='TENANT_MISMATCH'; throw e; }
            const existing = await client.query('SELECT organization_id FROM sceneshop_tracks WHERE id=$1',[t.id]);
            if (existing.rowCount && existing.rows[0].organization_id !== t.organizationId) { const e=new Error('Trilha de outra organização.'); e.code='TENANT_MISMATCH'; throw e; }
            const productIds=[...new Set((t.scenes||[]).flatMap((sc)=>(sc.products||[]).map((x)=>x.id)))];
            if (productIds.length) {
              const allowed=community
                ? await client.query('SELECT id FROM sceneshop_products WHERE id=ANY($1::text[]) AND (organization_id=$2 OR organization_id=$3 OR organization_id IS NULL)',[productIds,t.organizationId,workOrg])
                : await client.query('SELECT id FROM sceneshop_products WHERE id=ANY($1::text[]) AND (organization_id=$2 OR organization_id IS NULL)',[productIds,t.organizationId]);
              if (allowed.rowCount !== productIds.length) { const e=new Error('A trilha contém produto de outra organização.'); e.code='TENANT_MISMATCH'; throw e; }
            }
          }
          await writeTrackRows(client,t); return { saved:true };
        },
      };
    });
    return committed.result;
  }

  async publishTrackAsCommerceTrack(trackId, actor='system', organizationId=null) {
    return this.store.writeDomain(async (client) => {
      const track = await readTrack(client,String(trackId),organizationId ? String(organizationId) : null);
      if (!track) { const e=new Error('Trilha não encontrada.'); e.code='CONTENT_NOT_FOUND'; throw e; }
      if (track.type !== 'official') { const e=new Error('Somente trilha oficial pode originar publicação comercial.'); e.code='CONTENT_NOT_OFFICIAL'; throw e; }
      const work = await client.query('SELECT id,sync_id,organization_id FROM sceneshop_works WHERE id=$1 FOR UPDATE',[track.workId]);
      if (!work.rowCount) { const e=new Error('Obra não encontrada.'); e.code='CONTENT_NOT_FOUND'; throw e; }
      if (track.organizationId && work.rows[0].organization_id !== track.organizationId) { const e=new Error('Trilha e obra pertencem a organizações diferentes.'); e.code='TENANT_MISMATCH'; throw e; }
      const revQ = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS next FROM sceneshop_commerce_track_publications WHERE work_id=$1',[track.workId]);
      const revision = Number(revQ.rows[0].next);
      const publicationId = `ct:${track.workId}:r${revision}`;
      await client.query(`UPDATE sceneshop_commerce_track_publications SET status='RETIRED' WHERE work_id=$1 AND status='PUBLISHED'`,[track.workId]);
      await client.query(
        `INSERT INTO sceneshop_commerce_track_publications(id,work_id,organization_id,revision,status,published_by,published_at,manifest)
         VALUES($1,$2,$3,$4,'PUBLISHED',$5,now(),$6::jsonb)`,
        [publicationId,track.workId,track.organizationId||work.rows[0].organization_id||null,revision,actor,JSON.stringify({ sourceTrackId:track.id, syncId:work.rows[0].sync_id })]
      );
      let position=0;
      for (const scene of track.scenes || []) {
        for (const item of scene.products || []) {
          const pr = await client.query('SELECT * FROM sceneshop_products WHERE id=$1',[item.id]);
          if (!pr.rowCount) continue;
          const product = productFromRow(pr.rows[0]);
          const assetId = `asset:product:${product.id}`;
          await client.query(
            `INSERT INTO sceneshop_commercial_assets(id,owner_id,organization_id,product_id,brand,model,name,category,description,sku,status,metadata,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',$11::jsonb,now())
             ON CONFLICT(id) DO UPDATE SET organization_id=EXCLUDED.organization_id,product_id=EXCLUDED.product_id,brand=EXCLUDED.brand,name=EXCLUDED.name,
               category=EXCLUDED.category,description=EXCLUDED.description,sku=EXCLUDED.sku,status='approved',metadata=EXCLUDED.metadata,updated_at=now()`,
            [assetId,product.createdBy||track.authorId||null,track.organizationId||product.organizationId||null,product.id,product.brand||null,product.model||null,product.name,
             product.category||null,product.description||null,product.sku||null,JSON.stringify({ source:'LEGACY_PRODUCT', productId:product.id })]
          );
          const placementId = `pl:${track.id}:${scene.id}:${product.id}:r${revision}`;
          await client.query(
            `INSERT INTO sceneshop_placements(
               id,work_id,asset_id,physical_start_seconds,physical_end_seconds,display_start_seconds,display_end_seconds,
               status,priority,policy,approved_by,approved_at,source_track_id,source_scene_id,thumbnail_url)
             VALUES($1,$2,$3,$4,$5,$6,$7,'PUBLISHED',$8,$9::jsonb,$10,now(),$11,$12,$13)`,
            [placementId,track.workId,assetId,Number(scene.start||0)+Number(track.offset||0),Number(scene.end||0)+Number(track.offset||0),
             Number(scene.start||0)+Number(track.offset||0),Number(scene.end||0)+Number(track.offset||0),0,
             JSON.stringify({ match:item.match||'exato' }),actor,track.id,scene.id,scene.thumb||null]
          );
          await client.query(
            `INSERT INTO sceneshop_commerce_track_entries(publication_id,placement_id,position) VALUES($1,$2,$3)`,
            [publicationId,placementId,position++]
          );
        }
      }
      await client.query(
        `INSERT INTO sceneshop_outbox(topic,aggregate_type,aggregate_id,payload)
         VALUES('commerce_track.published','work',$1,$2::jsonb)`,
        [track.workId,JSON.stringify({ workId:track.workId, publicationId, revision, sourceTrackId:track.id })]
      );
      return { publicationId, workId:track.workId, revision, syncId:work.rows[0].sync_id, entries:position };
    });
  }

  async getPublishedTimeline(workId) {
    return this.store.readDomain(async (client) => {
      const pub = await client.query(
        `SELECT * FROM sceneshop_commerce_track_publications WHERE work_id=$1 AND status='PUBLISHED'
         ORDER BY revision DESC LIMIT 1`, [String(workId)]
      );
      if (!pub.rowCount) return null;
      const policyQ = await client.query('SELECT * FROM sceneshop_commerce_timeline_policies WHERE work_id=$1',[String(workId)]);
      const rows = await client.query(
        `SELECT e.position,p.id AS placement_id,p.display_start_seconds,p.display_end_seconds,p.thumbnail_url,
                p.source_scene_id,p.priority,p.policy,a.id AS asset_id,a.product_id,a.name,a.brand,a.model,a.category,a.description,a.sku
           FROM sceneshop_commerce_track_entries e
           JOIN sceneshop_placements p ON p.id=e.placement_id
           JOIN sceneshop_commercial_assets a ON a.id=p.asset_id
          WHERE e.publication_id=$1 ORDER BY e.position`, [pub.rows[0].id]
      );
      const byScene = new Map();
      for (const row of rows.rows) {
        const key = `${row.source_scene_id || row.placement_id}:${row.display_start_seconds}:${row.display_end_seconds}`;
        if (!byScene.has(key)) byScene.set(key, {
          sceneId: row.source_scene_id || null,
          start: Number(row.display_start_seconds), end: Number(row.display_end_seconds),
          thumbnail: row.thumbnail_url || null, products: [],
        });
        byScene.get(key).products.push({
          placementId:row.placement_id, assetId:row.asset_id, productId:row.product_id,
          name:row.name, brand:row.brand, model:row.model, category:row.category,
          description:row.description, sku:row.sku, priority:Number(row.priority||0), policy:row.policy||{},
        });
      }
      const p = pub.rows[0];
      const policy = policyQ.rowCount ? policyQ.rows[0] : null;
      return {
        workId:String(workId), publicationId:p.id, revision:Number(p.revision), organizationId:p.organization_id||null, publishedAt:millis(p.published_at),
        manifest:p.manifest||{},
        policy: policy ? {
          visibility:policy.visibility, thumbnailsEnabled:!!policy.thumbnails_enabled,
          missedItemsEnabled:!!policy.missed_items_enabled, allowSceneSeek:!!policy.allow_scene_seek,
          metadata:policy.metadata||{},
        } : { visibility:'PAST_AND_CURRENT', thumbnailsEnabled:true, missedItemsEnabled:true, allowSceneSeek:false, metadata:{} },
        scenes:[...byScene.values()],
      };
    });
  }
}

module.exports = { PostgresContentRepository, workFromRow, productFromRow, trackHeadFromRow, hydrateTrack, readTrack, writeTrackRows };
