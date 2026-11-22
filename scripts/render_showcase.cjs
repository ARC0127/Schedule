// Compose a repository banner from the app's synthetic-data screenshots.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const png=name=>'data:image/png;base64,'+fs.readFileSync(path.join(root,name)).toString('base64');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1200},deviceScaleFactor:1});
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#eff4ee;color:#163b2c;font-family:'Segoe UI',sans-serif}
  main{height:1200px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 90% 85%,#c8dcc9 0%,transparent 52%),linear-gradient(135deg,#f8faf6,#eaf1e8)}
  header{position:absolute;left:78px;top:64px;display:flex;align-items:center;gap:22px}header img{width:65px;height:65px}h1{font-size:48px;line-height:1;margin:0;letter-spacing:-2px;font-weight:650}
  .edition{position:absolute;right:78px;top:82px;font-size:15px;letter-spacing:2px;color:#54705d}
  h2{position:absolute;top:174px;left:78px;font-size:64px;line-height:1.08;font-weight:550;letter-spacing:-3px;margin:0}
  .lead{position:absolute;left:80px;top:324px;font-size:22px;color:#5d7165;margin:0}
  .desktop{position:absolute;left:78px;top:418px;width:1100px;border:1px solid #c8d5c8;border-radius:15px;background:white;overflow:hidden;box-shadow:0 24px 65px #25463120,0 3px 10px #2546310c}
  .desktop img{width:100%;display:block}
  .phone{position:absolute;right:78px;top:370px;width:322px;padding:7px;background:#294337;border-radius:35px;box-shadow:0 26px 65px #25463130;border:1px solid #698572;overflow:hidden;transform:rotate(2deg)}
  .phone img{width:100%;display:block;border-radius:28px}
  .footer{position:absolute;bottom:29px;left:80px;right:78px;display:flex;justify-content:space-between;font-size:15px;color:#526a59;letter-spacing:.2px}
  .label{display:flex;align-items:center;gap:12px}.dot{width:7px;height:7px;border-radius:50%;background:#4f8761}
  </style></head><body><main>
  <header><img src="${png('assets/schedule-icon.png')}" alt=""><h1>Schedule</h1></header><div class="edition">WINDOWS + ANDROID</div>
  <h2>A little space.<br>A clearer day.</h2><p class="lead">Ideas, projects and plans. Together, on your devices.</p>
  <div class="desktop"><img src="${png('docs/images/home.png')}" alt="Windows app"></div>
  <div class="phone"><img src="${png('docs/images/android-home.png')}" alt="Android app"></div>
  <div class="footer"><div class="label"><i class="dot"></i> LOCAL NOTES &nbsp; / &nbsp; TWO-WAY SYNC &nbsp; / &nbsp; ORIGINAL IMAGES</div><span>ARCLIGHT · OPEN SOURCE</span></div>
  </main></body></html>`);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(root,'docs/images/hero.png')});
  console.log('Rendered docs/images/hero.png from synthetic desktop and Android app screenshots');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
