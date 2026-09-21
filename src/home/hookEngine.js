import {createHookHands} from './hookHands';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

// One lazy renderer for the landing hook with a small Blender aperture loaded at the garden chapter
export function createHookScene(host) {
  const renderer = new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  host.appendChild(renderer.domElement);
  const water = new THREE.Scene(), waterCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const pointer=new THREE.Vector2(.5,.42), target=new THREE.Vector2(.5,.42); let pressed=false,wake=0;
  const uniforms = {time:{value:0},aspect:{value:1},pointer:{value:pointer},pressure:{value:0},surface:{value:null},textured:{value:0}};
  const waterMaterial = new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`precision mediump float;
      varying vec2 vUv; uniform float time; uniform float aspect; uniform vec2 pointer; uniform float pressure; uniform sampler2D surface; uniform float textured;
      void main(){
        vec2 uv=vUv*vec2(aspect,1.); vec2 q=uv*5.;
        float t=time*.12;
        for(int i=1;i<7;i++){float k=float(i);q+=vec2(sin(q.y*k+t),cos(q.x*k-t))*1.05/k;}
        float waves=sin(q.x*8.+sin(q.y*5.+t))*cos(q.y*7.-t);
        float detail=sin(q.x*13.+cos(q.y*11.-t))*cos(q.y*12.+t);
        float caustic=pow(1.-abs(waves),24.)*.7+pow(1.-abs(detail),30.)*.3;
        float d=length((vUv-pointer)*vec2(aspect,1.));
        float ripple=sin(d*90.-time*5.)*exp(-d*5.)*pressure;
        caustic+=ripple*.35;
        float clouds=sin(q.x*1.7+q.y)*.5+.5;
        vec3 col=mix(vec3(.14,.47,.37),vec3(.66,.86,.72),clouds*.65+vUv.y*.15);
        col+=caustic*.19; col+=pow(max(0.,1.-distance(vUv,vec2(.65,.7))),5.)*.16;
        vec2 drift=vec2(sin(vUv.y*12.+t),cos(vUv.x*14.-t))*.004;
        vec2 displacement=normalize(vUv-pointer+vec2(.0001))*ripple*.009;
        vec2 photoUv=(vUv-.5)*vec2(min(1.,aspect/1.7768),min(1.,1.7768/aspect))+.5;
        vec3 photographic=texture2D(surface,clamp(photoUv+drift+displacement,.002,.998)).rgb;
        col=mix(col,photographic+vec3(ripple*.04+caustic*.012),textured);
        gl_FragColor=vec4(col,1.);
      }`});
  const plane = new THREE.PlaneGeometry(2,2); water.add(new THREE.Mesh(plane,waterMaterial));
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#131111');
  const camera = new THREE.PerspectiveCamera(42,1,.1,50); camera.position.z=8;
  const environmentScene = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(environmentScene,.04); scene.environment=environment.texture;
  environmentScene.dispose(); pmrem.dispose();
  const group = new THREE.Group(); scene.add(group);
  let model = null, loading = false;
  const abort = new AbortController();
  const disposeModel = (object) => {
    const geometries=new Set(),materials=new Set();
    object.traverse(mesh=>{if(mesh.isMesh){geometries.add(mesh.geometry);(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>materials.add(m));}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  };
  const loadModel = async () => {
    if (loading || model) return; loading=true;
    try {
      const response=await fetch('/scenes/provision-hook-portal.glb',{signal:abort.signal});
      if(!response.ok)throw new Error('Aperture unavailable');
      const gltf=await new GLTFLoader().parseAsync(await response.arrayBuffer(),'');
      if(disposed){disposeModel(gltf.scene);return;}
      model=gltf.scene;
      model.traverse(mesh=>{if(mesh.isMesh)mesh.material.envMapIntensity=1.5;});
      group.add(model);ring.visible=false;sync();
    } catch { loading=false; }
  };
  const ringGeo=new THREE.TorusGeometry(2.15,.025,8,96);
  const ringMaterial=new THREE.MeshBasicMaterial({color:'#ded4d4'});
  const ring=new THREE.Mesh(ringGeo,ringMaterial); group.add(ring);
  scene.add(new THREE.HemisphereLight('#efeaea','#121010',2.4));
  const light=new THREE.PointLight('#f28c8c',65,20);light.position.set(2,3,4);scene.add(light);
  let hands;
  let chapter=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,visible=true,frame=0,last=0,elapsed=0,entered=0,disposed=false;
  const draw=()=>{pointer.lerp(target,.15);wake*=.96;uniforms.pressure.value+=((pressed?1:wake)-uniforms.pressure.value)*.08;
    if(chapter===0){uniforms.time.value=elapsed;renderer.render(water,waterCamera);}else if(chapter===1 || chapter===2){renderer.setClearColor('#000000',0);renderer.clear();}else if(chapter===3 || chapter===4){
    group.rotation.z=elapsed*.08;group.rotation.y=Math.sin(elapsed*.2)*.22;
    const reveal=paused?1:Math.min(1,(elapsed-entered)/2.2);
    const ease=1-Math.pow(1-reveal,3);
    group.scale.setScalar(chapter===4 ? .95 : .7+ease*.45);
    group.rotation.y=Math.sin(elapsed*.17)*.25;
    if(model) model.children.forEach(mesh=>{
      if(mesh.name.startsWith('Blade_')) {
        const i=Number(mesh.name.split('_')[1]);
        const spread=chapter===4?.08:ease*.24;
        mesh.position.x=Math.cos(i/6*Math.PI*2)*spread;
        mesh.position.y=Math.sin(i/6*Math.PI*2)*spread;
      }
    });
    renderer.render(scene,camera);
  }
    hands?.render(chapter,elapsed,uniforms.aspect.value,pointer,pressed);
  };
  const tick=(now)=>{frame=0;if(disposed||paused||!visible||document.hidden||![0,1,2,3,4].includes(chapter))return;
    if(now-last>=33){elapsed+=Math.min((now-last)/1000,.05);last=now;draw();}frame=requestAnimationFrame(tick);};
  const sync=()=>{cancelAnimationFrame(frame);frame=0;last=performance.now();draw();if(!disposed&&!paused&&visible&&!document.hidden&&[0,1,2,3,4].includes(chapter))frame=requestAnimationFrame(tick);};
  const resize=()=>{const {width,height}=host.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);uniforms.aspect.value=width/height;camera.aspect=width/height;camera.position.z=width<700?10:8;camera.updateProjectionMatrix();draw();};
  const observer=new ResizeObserver(resize);observer.observe(host);
  const visibility=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();});visibility.observe(host);
  hands=createHookHands(renderer,environment.texture,abort.signal,()=>{if(!disposed)sync();});
  const waterTexture=new THREE.TextureLoader().load('/scenes/provision-mint-water.webp',texture=>{if(disposed){texture.dispose();return;}uniforms.surface.value=texture;uniforms.textured.value=1;sync();});
  document.addEventListener('visibilitychange',sync);resize();sync();
  return {
    setChapter(next){if(chapter!==next)entered=elapsed;chapter=next;if(next>=2)loadModel();host.dataset.renderVisible='true';sync();},
    pointer(x,y,down){target.set(x,y);pressed=down;wake=.7;if(paused)draw();},
    pause(value){paused=value;sync();},
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();visibility.disconnect();document.removeEventListener('visibilitychange',sync);plane.dispose();waterMaterial.dispose();waterTexture.dispose();abort.abort();hands?.dispose();if(model)disposeModel(model);ringGeo.dispose();ringMaterial.dispose();environment.dispose();renderer.dispose();renderer.domElement.remove();}
  };
}
