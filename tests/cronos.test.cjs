const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture,key}=require('./fixtures/cronos.cjs');
const root=path.join(__dirname,'..');
const json=x=>JSON.parse(JSON.stringify(x));
function setup(){
 const context=vm.createContext({console,Blob,TextDecoder,TextEncoder,Uint8Array,Uint32Array,ArrayBuffer,DataView,DOMException,AbortController,DecompressionStream,setTimeout,clearTimeout});context.window=context;
 for(const file of ['core/bouquet.js','core/i18n.js','core/sources.js','modules/cronos.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
 return {B:context.Bouquet,plugin:context.Bouquet.interpreters.find(p=>p.id==='cronos')};
}
async function open(plugin,B,data,name='CroStru.dat'){
 const files=Object.entries(data).map(([name,bytes])=>({name,open:()=>B.util.blobSource(new Blob([bytes]),name)}));
 return plugin.open({name,source:files.find(f=>f.name===name)?.open(),files});
}
for(const version of ['01.02','01.03','01.11'])test('Cronos '+version+': schema, compression, extended records, dates, times, pagination and deleted entries',async()=>{
 const {B,plugin}=setup(),db=await open(plugin,B,fixture({version,extended:true}));
 assert.equal(db.tables.length,1);assert.deepEqual(json(db.tables[0].columns),['ID','Text','Date','Time']);
 const first=await db.tables[0].read({limit:2}),next=await db.tables[0].read({limit:2,cursor:first.nextCursor});
 assert.equal(first.scanned,first.nextCursor-1);assert.equal(next.scanned,next.nextCursor-1);
 assert.deepEqual(json(first.rows[0]),{n:1,cells:[1,'row0','2006-01-02','09:30']});
 assert.equal(next.rows[0].n,4);assert.equal(next.rows[0].cells[1],'row2');
 const filtered=await db.tables[0].read({match:cells=>cells[1]==='row7'});assert.equal(filtered.rows.length,1);assert.equal(filtered.hasMore,false);
 db.close();await assert.rejects(db.tables[0].read(),{name:'AbortError'});
});
for(const recovery of ['structure','database'])test('protected Cronos: automatically recovers KOD using '+recovery,async()=>{
 const {B,plugin}=setup();const db=await open(plugin,B,fixture({version:'01.04',protectedKey:true,recovery,count:recovery==='database'?320:8}));
 assert.equal((await db.tables[0].read({limit:1})).rows[0].cells[1],'row0');db.close();
});
test('missing related files are listed and expose an open-file action',async()=>{
 const {B,plugin}=setup(),data=fixture();delete data['CroBank.tad'];
 await assert.rejects(open(plugin,B,data),error=>Array.from(error.missingFiles).join(',')==='CroBank.tad');
 assert.equal(plugin.test({name:'Dir/CroBank.TAD'}),true);assert.equal(plugin.test({name:'unrelated.dat'}),false);
});
test('companion files are matched within the selected directory and case-insensitively',async()=>{
 const {B,plugin}=setup();const files={};for(const [name,value]of Object.entries(fixture()))files['root/'+name.toUpperCase()]=value;
 files['root/Voc/CROSTRU.DAT']=Buffer.from('wrong database');
 const db=await open(plugin,B,files,'root/CROSTRU.DAT');assert.equal((await db.tables[0].read({limit:1})).rows.length,1);db.close();
});
test('CRC failures and truncated files are rejected explicitly',async()=>{
 const {B,plugin}=setup(),data=fixture();data['CroBank.dat'][267]^=1;
 await assert.rejects(open(plugin,B,data));
 const truncated=fixture();truncated['CroStru.tad']=truncated['CroStru.tad'].subarray(0,10);await assert.rejects(open(plugin,B,truncated));
});
test('search yields, reports progress and honours cancellation',async()=>{
 const {B,plugin}=setup(),db=await open(plugin,B,fixture({count:320}));const controller=new AbortController();let progress=false;
 await assert.rejects(db.tables[0].read({match:()=>false,signal:controller.signal,onProgress(){progress=true;controller.abort();}}),{name:'AbortError'});
 assert.equal(progress,true);db.close();
});
test('manual KOD dialog validates input, clears it after use, and can be cancelled',async()=>{
 const {B,plugin}=setup();
 class Element{constructor(tag){this.tag=tag;this.children=[];this.value='';}appendChild(x){this.children.push(x);}setAttribute(){}showModal(){this.open=true;}close(){this.open=false;}remove(){this.removed=true;}focus(){}}
 const root=new Element('root');plugin.setup({root,document:{createElement:tag=>new Element(tag)}});
 const pending=open(plugin,B,fixture({version:'01.04',protectedKey:true}));
 for(let i=0;i<100&&!root.children.length;i++)await new Promise(r=>setTimeout(r,5));
 const dialog=root.children[0],form=dialog.children[0],input=form.children[2];
 input.value='ordinary password';form.onsubmit({preventDefault(){}});assert.equal(dialog.open,true);
 input.value=Buffer.from(key).toString('hex');form.onsubmit({preventDefault(){}});const db=await pending;
 assert.equal(input.value,'');assert.equal(dialog.removed,true);assert.equal((await db.tables[0].read({limit:1})).rows.length,1);db.close();
 const next=open(plugin,B,fixture({version:'01.04',protectedKey:true}));
 for(let i=0;i<100&&root.children.length<2;i++)await new Promise(r=>setTimeout(r,5));
 root.children[1].children[0].children.at(-1).onclick();await assert.rejects(next,{name:'AbortError'});
});
const sample=path.join(root,'data/Chel2006obl');
test('local Chel2006obl compatibility: schema and first pages, without disclosing records',{skip:!fs.existsSync(path.join(sample,'CroBank.dat'))},async()=>{
 const {B,plugin}=setup();const data=Object.fromEntries(fs.readdirSync(sample).filter(name=>/\.(dat|tad)$/i.test(name)).map(name=>[name,fs.readFileSync(path.join(sample,name))]));
 const db=await open(plugin,B,data);assert.deepEqual(json(db.tables.map(table=>table.columns.length)),[23,13,11]);
 for(const table of db.tables){const first=await table.read({limit:100});assert.equal(first.rows.length,100);assert.equal(first.hasMore,true);}
 db.close();
});

test('grouping uses directories, keeps incomplete databases together, and never reads file bytes', () => {
 const {plugin}=setup();
 const entries=['A','B'].flatMap(folder=>['Bank','Stru','Index'].flatMap(stem=>['dat','tad'].map(ext=>({name:folder+'/Cro'+stem+'.'+ext,load(){throw new Error('Must not read during grouping');}}))));
 const grouped=plugin.groupFiles(entries);
 assert.equal(grouped.length,2);assert.deepEqual(Array.from(grouped,x=>x.label),['A','B']);
 assert.equal(grouped[0].members.length,6);assert.equal(grouped[0].name,'A/CroStru.dat');
 assert.equal(plugin.groupFiles(entries.slice(0,3)).length,1);
 assert.equal(plugin.groupFiles([{name:'data.csv'},...entries]).length,3);
 const ambiguous=entries.map(entry=>({...entry,name:entry.name.split('/').at(-1)}));
 assert.equal(plugin.groupFiles(ambiguous).length,12);
});
