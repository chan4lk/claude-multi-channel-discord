(()=>{var e={};e.id=38,e.ids=[38],e.modules={6421:(e,t,s)=>{"use strict";s.d(t,{Ay:()=>l,Jj:()=>u,Ul:()=>o,dA:()=>E,kQ:()=>T,zl:()=>d});var n=s(87550),r=s.n(n);let a=process.env.MC_DB_PATH??"mc.db",i=parseInt(process.env.MC_RETENTION_DAYS??"30",10),c=new(r())(a);c.exec("PRAGMA journal_mode=WAL"),c.exec(`
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
`);let p=Math.floor(Date.now()/1e3)-86400*i;function o(e){c.prepare(`INSERT INTO events (instance_id, host, user, ts, type, payload)
     VALUES (?, ?, ?, ?, ?, ?)`).run(e.instance_id,e.host,e.user,e.ts,e.type,JSON.stringify(e.payload))}function u(e){c.prepare(`INSERT INTO instances (instance_id, host, user, api_key, last_seen)
       VALUES (?, ?, ?, '', ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         last_seen = excluded.last_seen,
         host      = excluded.host,
         user      = excluded.user`).run(e.instance_id,e.host,e.user,e.ts)}function E(){return c.prepare("SELECT * FROM instances ORDER BY created_at DESC").all()}function T(e){let t=[],s=[];e.instance_id&&(t.push("instance_id = ?"),s.push(e.instance_id)),e.type&&(t.push("type = ?"),s.push(e.type)),e.since&&(t.push("ts >= ?"),s.push(e.since));let n=t.length>0?`WHERE ${t.join(" AND ")}`:"",r=null!=e.limit?`LIMIT ${e.limit}`:"",a=`SELECT * FROM events ${n} ORDER BY created_at DESC ${r}`;return c.prepare(a).all(...s)}function d(e){let t=c.prepare(`
    SELECT DISTINCT json_extract(payload, '$.slug') AS slug
    FROM events
    WHERE instance_id = ?
      AND created_at > unixepoch() - 300
      AND json_extract(payload, '$.slug') IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 50
  `).all(e),s=c.prepare(`
    SELECT type
    FROM events
    WHERE instance_id = ?
      AND created_at > unixepoch() - 300
    ORDER BY created_at DESC
    LIMIT 1
  `).get(e);return{activeSlugs:t.map(e=>e.slug).filter(Boolean),lastActivity:s?.type??null}}c.prepare("DELETE FROM events WHERE created_at < ?").run(p);let l=c},10846:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},27171:(e,t,s)=>{"use strict";s.r(t),s.d(t,{patchFetch:()=>l,routeModule:()=>u,serverHooks:()=>d,workAsyncStorage:()=>E,workUnitAsyncStorage:()=>T});var n={};s.r(n),s.d(n,{GET:()=>o,dynamic:()=>p});var r=s(96559),a=s(48088),i=s(37719),c=s(6421);let p="force-dynamic";async function o(){let e=(0,c.dA)().map(e=>({...e,...(0,c.zl)(e.instance_id)}));return Response.json(e)}let u=new r.AppRouteRouteModule({definition:{kind:a.RouteKind.APP_ROUTE,page:"/api/instances/route",pathname:"/api/instances",filename:"route",bundlePath:"app/api/instances/route"},resolvedPagePath:"/home/openclaw/.claude/channels/discord-multi/projects/claude-mcd/apps/mission-control/app/api/instances/route.ts",nextConfigOutput:"",userland:n}),{workAsyncStorage:E,workUnitAsyncStorage:T,serverHooks:d}=u;function l(){return(0,i.patchFetch)({workAsyncStorage:E,workUnitAsyncStorage:T})}},29294:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-async-storage.external.js")},44870:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},63033:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},78335:()=>{},87550:e=>{"use strict";e.exports=require("better-sqlite3")},96487:()=>{},96559:(e,t,s)=>{"use strict";e.exports=s(44870)}};var t=require("../../../webpack-runtime.js");t.C(e);var s=e=>t(t.s=e),n=t.X(0,[719],()=>s(27171));module.exports=n})();