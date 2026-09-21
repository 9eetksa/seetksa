
const surfaceModule='/scenes/reference/brand-surfaces.js'
const { createBrandSurfaceAtlasCanvas }=await import(/* @vite-ignore */ surfaceModule)
const originals={}
const adapted={}
const assets={spcAtlas:'shards-petals-coins',moneyShredsAtlas:'leather-money-shreds',certAtlas:'board-certificates'}
await Promise.all(Object.entries(assets).map(async ([key,file])=>{
  const img=new Image()
  img.src=`/scenes/reference/assets/brand/base-${file}.webp`
  await img.decode()
  originals[key]=img
  adapted[key]=await createBrandSurfaceAtlasCanvas(key)
}))
function crop(source,rect,rotate=false){
  const [x,y,w,h]=rect
  const output=document.createElement('canvas')
  output.width=rotate?h:w
  output.height=rotate?w:h
  const ctx=output.getContext('2d')
  if(rotate){ctx.translate(0,w);ctx.rotate(-Math.PI/2)}
  ctx.drawImage(source,x,y,w,h,0,0,w,h)
  return output
}
function pair(id,title,key,rect,rotate=false){
  const section=document.createElement('section');section.id=id
  const heading=document.createElement('h2');heading.textContent=title;section.append(heading)
  const grid=document.createElement('div');grid.className='pair'
  for(const [label,sources] of [['Original',originals],['Seet',adapted]]){
    const wrap=document.createElement('div');const sub=document.createElement('h3');sub.textContent=label
    const image=crop(sources[key],rect,rotate);image.id=`${id}-${label==='Original'?'original':'brand'}`
    wrap.append(sub,image);grid.append(wrap)
  }
  section.append(grid);document.getElementById('surfaces').append(section)
}
pair('banknote','Banknote','moneyShredsAtlas',[1474,0,574,1284],true)
pair('quotes','Quote panel portrait and logo','moneyShredsAtlas',[0,0,492,912])
pair('quote-lower','Lower quote panel portrait and logo','moneyShredsAtlas',[492,913,490,1135])
pair('certificates','Certificate 1','certAtlas',[0,0,658,512])
pair('certificate-watermark','Certificate paper and watermark','certAtlas',[658,1536,658,512])
pair('coins','Eight original coin silhouettes','spcAtlas',[0,1877,2048,171])
pair('statistics','Statistics print','spcAtlas',[0,0,856,381])
pair('statistic-rotated','Rotated statistics print','spcAtlas',[1765,0,283,735],true)
const all=document.createElement('section');all.id='atlases';all.innerHTML='<h2>Full branded atlases</h2><div class="full"></div>'
for(const key of Object.keys(adapted)){adapted[key].id=`atlas-${key}`;all.lastChild.append(adapted[key])}
document.getElementById('surfaces').append(all)
document.getElementById('status').textContent='Original artwork and branded copy loaded'
window.__surfaceReview={originals,adapted}
