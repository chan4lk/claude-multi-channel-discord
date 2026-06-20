(()=>{var e={};e.id=301,e.ids=[301],e.modules={6421:(e,t,s)=>{"use strict";s.d(t,{Ay:()=>l,Jj:()=>p,Ul:()=>u,dA:()=>d,kQ:()=>T,zl:()=>E});var n=s(87550),r=s.n(n);let a=process.env.MC_DB_PATH??"mc.db",i=parseInt(process.env.MC_RETENTION_DAYS??"30",10),o=new(r())(a);o.exec("PRAGMA journal_mode=WAL"),o.exec(`
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
`);let c=Math.floor(Date.now()/1e3)-86400*i;function u(e){o.prepare(`INSERT INTO events (instance_id, host, user, ts, type, payload)
     VALUES (?, ?, ?, ?, ?, ?)`).run(e.instance_id,e.host,e.user,e.ts,e.type,JSON.stringify(e.payload))}function p(e){o.prepare(`INSERT INTO instances (instance_id, host, user, api_key, last_seen)
       VALUES (?, ?, ?, '', ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         last_seen = excluded.last_seen,
         host      = excluded.host,
         user      = excluded.user`).run(e.instance_id,e.host,e.user,e.ts)}function d(){return o.prepare("SELECT * FROM instances ORDER BY created_at DESC").all()}function T(e){let t=[],s=[];e.instance_id&&(t.push("instance_id = ?"),s.push(e.instance_id)),e.type&&(t.push("type = ?"),s.push(e.type)),e.since&&(t.push("ts >= ?"),s.push(e.since));let n=t.length>0?`WHERE ${t.join(" AND ")}`:"",r=null!=e.limit?`LIMIT ${e.limit}`:"",a=`SELECT * FROM events ${n} ORDER BY created_at DESC ${r}`;return o.prepare(a).all(...s)}function E(e){let t=o.prepare(`
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
  `).get(e);return{activeSlugs:t.map(e=>e.slug).filter(Boolean),lastActivity:s?.type??null}}o.prepare("DELETE FROM events WHERE created_at < ?").run(c);let l=o},10846:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},29294:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-async-storage.external.js")},30785:(e,t,s)=>{"use strict";s.r(t),s.d(t,{patchFetch:()=>R,routeModule:()=>E,serverHooks:()=>N,workAsyncStorage:()=>l,workUnitAsyncStorage:()=>_});var n={};s.r(n),s.d(n,{GET:()=>d,POST:()=>T,dynamic:()=>p});var r=s(96559),a=s(48088),i=s(37719),o=s(6421),c=s(93573),u=s(63430);let p="force-dynamic";async function d(e){let{searchParams:t}=e.nextUrl,s=parseInt(t.get("limit")??"",10),n=isNaN(s)?200:Math.min(s,500),r={instance_id:t.get("instance_id")??void 0,type:t.get("type")??void 0,since:t.get("since")??void 0,limit:n},a=(0,o.kQ)(r);return Response.json(a)}async function T(e){let t,s=e.headers.get("Authorization")??"",n=s.startsWith("Bearer ")?s.slice(7):"";if(!n||!(0,c.e)(n))return new Response("Unauthorized",{status:401});try{t=await e.json()}catch{return new Response("Bad Request",{status:400})}return(0,o.Ul)(t),(0,o.Jj)(t),(0,u.mq)(t),new Response("OK",{status:200})}let E=new r.AppRouteRouteModule({definition:{kind:a.RouteKind.APP_ROUTE,page:"/api/events/route",pathname:"/api/events",filename:"route",bundlePath:"app/api/events/route"},resolvedPagePath:"/home/openclaw/.claude/channels/discord-multi/projects/claude-mcd/apps/mission-control/app/api/events/route.ts",nextConfigOutput:"",userland:n}),{workAsyncStorage:l,workUnitAsyncStorage:_,serverHooks:N}=E;function R(){return(0,i.patchFetch)({workAsyncStorage:l,workUnitAsyncStorage:_})}},44870:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},48161:e=>{"use strict";e.exports=require("node:os")},51455:e=>{"use strict";e.exports=require("node:fs/promises")},63033:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},63430:(e,t,s)=>{"use strict";s.d(t,{d5:()=>a,en:()=>i,mq:()=>o});let n=globalThis,r=n.__mcdClients??=new Set;function a(e){r.add(e)}function i(e){r.delete(e)}function o(e){let t=`data: ${JSON.stringify(e)}

`;for(let e of r)try{e.enqueue(t)}catch{r.delete(e)}}},73024:e=>{"use strict";e.exports=require("node:fs")},76760:e=>{"use strict";e.exports=require("node:path")},77598:e=>{"use strict";e.exports=require("node:crypto")},78335:()=>{},87550:e=>{"use strict";e.exports=require("better-sqlite3")},93573:(e,t,s)=>{"use strict";s.d(t,{e:()=>u,j:()=>c});var n=s(64146),r=s(87550),a=s.n(r),i=s(6421);let o=process.env.MC_DB_PATH??"mc.db",c=(0,n.l)({database:new(a())(o),secret:process.env.BETTER_AUTH_SECRET,baseURL:process.env.BETTER_AUTH_URL,emailAndPassword:{enabled:!0},rateLimit:{enabled:"false"!==process.env.BETTER_AUTH_RATE_LIMIT}});function u(e){return null!==i.Ay.prepare("SELECT 1 FROM instances WHERE api_key = ? LIMIT 1").get(e)}},96487:()=>{}};var t=require("../../../webpack-runtime.js");t.C(e);var s=e=>t(t.s=e),n=t.X(0,[719,688],()=>s(30785));module.exports=n})();