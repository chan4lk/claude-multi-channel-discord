(()=>{var e={};e.id=302,e.ids=[302],e.modules={3295:e=>{"use strict";e.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},6421:(e,t,s)=>{"use strict";s.d(t,{Ay:()=>l,Jj:()=>o,Ul:()=>T,dA:()=>c,kQ:()=>E,zl:()=>d});var r=s(87550),n=s.n(r);let a=process.env.MC_DB_PATH??"mc.db",i=parseInt(process.env.MC_RETENTION_DAYS??"30",10),p=new(n())(a);p.exec("PRAGMA journal_mode=WAL"),p.exec(`
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
`);let u=Math.floor(Date.now()/1e3)-86400*i;function T(e){p.prepare(`INSERT INTO events (instance_id, host, user, ts, type, payload)
     VALUES (?, ?, ?, ?, ?, ?)`).run(e.instance_id,e.host,e.user,e.ts,e.type,JSON.stringify(e.payload))}function o(e){p.prepare(`INSERT INTO instances (instance_id, host, user, api_key, last_seen)
       VALUES (?, ?, ?, '', ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         last_seen = excluded.last_seen,
         host      = excluded.host,
         user      = excluded.user`).run(e.instance_id,e.host,e.user,e.ts)}function c(){return p.prepare("SELECT * FROM instances ORDER BY created_at DESC").all()}function E(e){let t=[],s=[];e.instance_id&&(t.push("instance_id = ?"),s.push(e.instance_id)),e.type&&(t.push("type = ?"),s.push(e.type)),e.since&&(t.push("ts >= ?"),s.push(e.since));let r=t.length>0?`WHERE ${t.join(" AND ")}`:"",n=null!=e.limit?`LIMIT ${e.limit}`:"",a=`SELECT * FROM events ${r} ORDER BY created_at DESC ${n}`;return p.prepare(a).all(...s)}function d(e){let t=p.prepare(`
    SELECT DISTINCT json_extract(payload, '$.slug') AS slug
    FROM events
    WHERE instance_id = ?
      AND created_at > unixepoch() - 300
      AND json_extract(payload, '$.slug') IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 50
  `).all(e),s=p.prepare(`
    SELECT type
    FROM events
    WHERE instance_id = ?
      AND created_at > unixepoch() - 300
    ORDER BY created_at DESC
    LIMIT 1
  `).get(e);return{activeSlugs:t.map(e=>e.slug).filter(Boolean),lastActivity:s?.type??null}}p.prepare("DELETE FROM events WHERE created_at < ?").run(u);let l=p},10846:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},24068:(e,t,s)=>{"use strict";s.r(t),s.d(t,{patchFetch:()=>d,routeModule:()=>T,serverHooks:()=>E,workAsyncStorage:()=>o,workUnitAsyncStorage:()=>c});var r={};s.r(r),s.d(r,{GET:()=>p,POST:()=>u});var n=s(96559),a=s(48088),i=s(37719);let{GET:p,POST:u}=function(e){let t=async t=>"handler"in e?e.handler(t):e(t);return{GET:t,POST:t,PATCH:t,PUT:t,DELETE:t}}(s(93573).j),T=new n.AppRouteRouteModule({definition:{kind:a.RouteKind.APP_ROUTE,page:"/api/auth/[...all]/route",pathname:"/api/auth/[...all]",filename:"route",bundlePath:"app/api/auth/[...all]/route"},resolvedPagePath:"/home/openclaw/.claude/channels/discord-multi/projects/claude-mcd/apps/mission-control/app/api/auth/[...all]/route.ts",nextConfigOutput:"",userland:r}),{workAsyncStorage:o,workUnitAsyncStorage:c,serverHooks:E}=T;function d(){return(0,i.patchFetch)({workAsyncStorage:o,workUnitAsyncStorage:c})}},29294:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-async-storage.external.js")},44870:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},48161:e=>{"use strict";e.exports=require("node:os")},51455:e=>{"use strict";e.exports=require("node:fs/promises")},63033:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},73024:e=>{"use strict";e.exports=require("node:fs")},76760:e=>{"use strict";e.exports=require("node:path")},77598:e=>{"use strict";e.exports=require("node:crypto")},78335:()=>{},87550:e=>{"use strict";e.exports=require("better-sqlite3")},93573:(e,t,s)=>{"use strict";s.d(t,{e:()=>T,j:()=>u});var r=s(64146),n=s(87550),a=s.n(n),i=s(6421);let p=process.env.MC_DB_PATH??"mc.db",u=(0,r.l)({database:new(a())(p),secret:process.env.BETTER_AUTH_SECRET,baseURL:process.env.BETTER_AUTH_URL,emailAndPassword:{enabled:!0},rateLimit:{enabled:"false"!==process.env.BETTER_AUTH_RATE_LIMIT}});function T(e){return null!==i.Ay.prepare("SELECT 1 FROM instances WHERE api_key = ? LIMIT 1").get(e)}},96487:()=>{}};var t=require("../../../../webpack-runtime.js");t.C(e);var s=e=>t(t.s=e),r=t.X(0,[719,688],()=>s(24068));module.exports=r})();