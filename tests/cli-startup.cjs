const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),appDir=path.join(root,'dist/Schedule'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'schedule-cli-startup-'));
const env={...process.env,SCHEDULE_TEST_DATA:profile};
async function request(value) {
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(appDir,'Schedule.Cli.exe'),[],{env,windowsHide:true});let output='';
    child.stdout.on('data',b=>output+=b);child.on('error',reject);child.on('exit',()=>{try{resolve(JSON.parse(output));}catch(e){reject(Error(output));}});
    child.stdin.end(JSON.stringify(value));
  });
}
(async()=>{
  let pid;
  try {
    const capabilities=await request({op:'capabilities'});assert.equal(capabilities.ok,true,JSON.stringify(capabilities));
    pid=capabilities.result.processId;assert.equal(path.resolve(capabilities.result.dataDirectory),profile);
    const day=await request({op:'get_day',date:'2030-01-01'});
    const write=await request({op:'add_idea',date:'2030-01-01',text:'Cold CLI startup',revision:day.revision});assert.ok(write.ok,JSON.stringify(write));
    const read=await request({op:'get_day',date:'2030-01-01'});assert.equal(read.result.record.body,'• Cold CLI startup');
    const report={passed:true,cases:['CLI starts a closed app in the background','canonical requested profile and live reads/writes']};
    fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/cli-startup-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  } finally {
    spawn(path.join(appDir,'Journal.exe'),['--exit'],{env,windowsHide:true});
    if(pid) {
      for(let i=0;i<50;i++) {
        try {process.kill(pid,0);}catch{return;}
        await new Promise(r=>setTimeout(r,100));
      }
      throw Error('API host failed to exit after save');
    }
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
