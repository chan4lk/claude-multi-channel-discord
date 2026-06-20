(()=>{var e={};e.id=950,e.ids=[950],e.modules={3295:e=>{"use strict";e.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},6421:(e,t,s)=>{"use strict";s.d(t,{Ay:()=>l,Jj:()=>c,Ul:()=>u,dA:()=>d,kQ:()=>E,zl:()=>T});var r=s(87550),n=s.n(r);let a=process.env.MC_DB_PATH??"mc.db",i=parseInt(process.env.MC_RETENTION_DAYS??"30",10),o=new(n())(a);o.exec("PRAGMA journal_mode=WAL"),o.exec(`
CREATE TABLE IF NOT EXISTS instances (
  instance_id TEXT PRIMARY KEY,
  host        TEXT NOT NULL,
  user        TEXT NOT NULL,
  api_key     TEXT NOT NULL,
  last_seen   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  host        TEXT NOT NULL,
  user        TEXT NOT NULL,
  ts          TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_events_instance   ON events(instance_id);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
`);let p=Math.floor(Date.now()/1e3)-86400*i;function u(e){o.prepare(`INSERT INTO events (instance_id, host, user, ts, type, payload)
     VALUES (?, ?, ?, ?, ?, ?)`).run(e.instance_id,e.host,e.user,e.ts,e.type,JSON.stringify(e.payload))}function c(e){o.prepare(`INSERT INTO instances (instance_id, host, user, api_key, last_seen)
       VALUES (?, ?, ?, '', ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         last_seen = excluded.last_seen,
         host      = excluded.host,
         user      = excluded.user`).run(e.instance_id,e.host,e.user,e.ts)}function d(){return o.prepare("SELECT * FROM instances ORDER BY created_at DESC").all()}function E(e){let t=[],s=[];e.instance_id&&(t.push("instance_id = ?"),s.push(e.instance_id)),e.type&&(t.push("type = ?"),s.push(e.type)),e.since&&(t.push("ts >= ?"),s.push(e.since));let r=t.length>0?`WHERE ${t.join(" AND ")}`:"",n=null!=e.limit?`LIMIT ${e.limit}`:"",a=`SELECT * FROM events ${r} ORDER BY created_at DESC ${n}`;return o.prepare(a).all(...s)}function T(e){let t=o.prepare(`
    SELECT DISTINCT json_extract(payload, '$.slug') AS slug
    FROM events
    WHERE instance_id = ?
      AND created_at > unixepoch() - 300
      AND json_extract(payload, '$.slug') IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 50
  `).all(e),s=o.prepare(`
    SELECT type
    FROM events
    WHERE instance_id = ?
      AND created_at > unixepoch() - 300
    ORDER BY created_at DESC
    LIMIT 1
  `).get(e);return{activeSlugs:t.map(e=>e.slug).filter(Boolean),lastActivity:s?.type??null}}o.prepare("DELETE FROM events WHERE created_at < ?").run(p);let l=o},10846:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},29294:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-async-storage.external.js")},44870:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},48161:e=>{"use strict";e.exports=require("node:os")},51455:e=>{"use strict";e.exports=require("node:fs/promises")},63033:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},73024:e=>{"use strict";e.exports=require("node:fs")},76760:e=>{"use strict";e.exports=require("node:path")},77598:e=>{"use strict";e.exports=require("node:crypto")},78335:()=>{},87550:e=>{"use strict";e.exports=require("better-sqlite3")},93573:(e,t,s)=>{"use strict";s.d(t,{e:()=>u,j:()=>p});var r=s(64146),n=s(87550),a=s.n(n),i=s(6421);let o=process.env.MC_DB_PATH??"mc.db",p=(0,r.l)({database:new(a())(o),secret:process.env.BETTER_AUTH_SECRET,baseURL:process.env.BETTER_AUTH_URL,emailAndPassword:{enabled:!0},rateLimit:{enabled:"false"!==process.env.BETTER_AUTH_RATE_LIMIT}});function u(e){return null!==i.Ay.prepare("SELECT 1 FROM instances WHERE api_key = ? LIMIT 1").get(e)}},96487:()=>{},97347:(e,t,s)=>{"use strict";s.r(t),s.d(t,{patchFetch:()=>N,routeModule:()=>d,serverHooks:()=>l,workAsyncStorage:()=>E,workUnitAsyncStorage:()=>T});var r={};s.r(r),s.d(r,{GET:()=>c,dynamic:()=>u});var n=s(96559),a=s(48088),i=s(37719),o=s(93573),p=s(44999);let u="force-dynamic";async function c(){if(!await o.j.api.getSession({headers:await (0,p.headers)()}))return Response.json({error:"Unauthorized"},{status:401});let e=o.j.options.database.prepare("SELECT id, name, email, createdAt FROM user ORDER BY createdAt DESC").all();return Response.json(e)}let d=new n.AppRouteRouteModule({definition:{kind:a.RouteKind.APP_ROUTE,page:"/api/admin/users/route",pathname:"/api/admin/users",filename:"route",bundlePath:"app/api/admin/users/route"},resolvedPagePath:"/home/openclaw/.claude/channels/discord-multi/projects/claude-mcd/apps/mission-control/app/api/admin/users/route.ts",nextConfigOutput:"",userland:r}),{workAsyncStorage:E,workUnitAsyncStorage:T,serverHooks:l}=d;function N(){return(0,i.patchFetch)({workAsyncStorage:E,workUnitAsyncStorage:T})}}};var t=require("../../../../webpack-runtime.js");t.C(e);var s=e=>t(t.s=e),r=t.X(0,[719,688,999],()=>s(97347));module.exports=r})();