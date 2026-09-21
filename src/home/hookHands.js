import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

export function createHookHands(renderer, environment, signal, redraw) {
  const scene=new THREE.Scene();scene.environment=environment;
  const camera=new THREE.OrthographicCamera(-5,5,3,-3,.1,30);camera.position.z=12;
  scene.add(new THREE.HemisphereLight('#fff9dc','#664e4e',1.5));
  const key=new THREE.DirectionalLight('#fff5d6',2.3);key.position.set(-3,4,7);scene.add(key);
  const rim=new THREE.DirectionalLight('#dfd7d7',.8);rim.position.set(5,-2,2);scene.add(rim);
  const hands=[];let disposed=false;
  const materials=new Set(),geometries=new Set();
  const ready=Promise.all(['left','right'].map(async(side)=>{
    const response=await fetch(`/scenes/hand-${side}.glb`,{signal});
    if(!response.ok)throw new Error('Hand unavailable');
    const gltf=await new GLTFLoader().parseAsync(await response.arrayBuffer(),'');
    if(disposed){gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return;}
    const object=gltf.scene;object.updateMatrixWorld(true);
    const wrist=object.getObjectByName('wrist');
    const center=wrist.getWorldPosition(new THREE.Vector3());
    const joints=[];
    for(const finger of ['thumb','index-finger','middle-finger','ring-finger','pinky-finger']){
      const names=finger==='thumb'?['metacarpal','phalanx-proximal','phalanx-distal','tip']:['metacarpal','phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'];
      let parent=wrist;
      names.forEach((name,i)=>{const bone=object.getObjectByName(`${finger}-${name}`);if(!bone)return;parent.attach(bone);parent=bone;
        if(i>0&&!name.includes('tip')){
          const axis=new THREE.Vector3(0,0,side==='left'?1:-1).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
          joints.push({bone,base:bone.quaternion.clone(),axis,finger,i});
        }
      });
    }
    object.position.sub(center);
    const material=new THREE.MeshPhysicalMaterial({color:side==='left'?'#745a5a':'#e0d8c8',metalness:side==='left'?.22:.1,roughness:.3,clearcoat:1,clearcoatRoughness:.16,envMapIntensity:.7});materials.add(material);
    object.traverse(mesh=>{if(mesh.isMesh){mesh.material.dispose();mesh.material=material;mesh.frustumCulled=false;geometries.add(mesh.geometry);}});
    const wrapper=new THREE.Group();wrapper.add(object);scene.add(wrapper);
    const forearmGeometry=new THREE.CylinderGeometry(.029,.041,.36,32,1);
    geometries.add(forearmGeometry);
    const forearm=new THREE.Mesh(forearmGeometry,material);forearm.scale.x=.7;forearm.position.y=.17;wrapper.add(forearm);
    hands.push({side,wrapper,joints,tip:object.getObjectByName('index-finger-tip')});redraw();
  })).catch(()=>{});
  const q=new THREE.Quaternion();
  return {
    ready,
    render(chapter,time,aspect,pointer,pressed){
      if(![0,1,2].includes(chapter))return;
      camera.left=-aspect*3;camera.right=aspect*3;camera.updateProjectionMatrix();
      hands.forEach(({side,wrapper,joints,tip})=>{
        const left=side==='left';wrapper.visible=chapter===2||left;
        const scale=Math.min(17,aspect*12);
        wrapper.scale.setScalar(scale);
        if(chapter===2){
          wrapper.rotation.set(.3+(pointer.y-.5)*.14,left?-1.25:1.25,left?1.3:-1.3,'ZYX');
          wrapper.position.set((left?-1:1)*(Math.min(aspect*2.65,3.65)-(pressed?.22:0))+(pointer.x-.5)*.3,-.45+(pointer.y-.5)*.25,0);
        }else if(chapter===0){
          wrapper.scale.setScalar(Math.min(16,aspect*13));
          wrapper.rotation.set(.15,-Math.PI/2,Math.PI*.86+(pointer.x-.5)*.2,'ZYX');
          wrapper.position.set((pointer.x-.5)*aspect*4.8+.65,(pointer.y-.5)*5-1.65,0);
        }else{
          wrapper.scale.setScalar(Math.min(22,aspect*17));
          wrapper.rotation.set(.18,-Math.PI/2,Math.PI+Math.sin(time*.3)*.14,'ZYX');
          wrapper.position.set(aspect*.65+(pointer.x-.5)*.4,-2.7+(pointer.y-.5)*.3,-.3);
        }
        joints.forEach(({bone,base,axis,finger,i})=>{
          const index=finger==='index-finger';
          const curl=chapter===0?(index?.05:.85):(index?.12:.48+Math.sin(time*.6+i)*.04);
          bone.quaternion.copy(base).multiply(q.setFromAxisAngle(axis,finger==='thumb'?.65:curl));
        });
        if(chapter===0){wrapper.updateMatrixWorld(true);const current=tip.getWorldPosition(new THREE.Vector3());wrapper.position.add(new THREE.Vector3((pointer.x-.5)*aspect*6,(pointer.y-.5)*6,0).sub(current));}
        if(chapter===2){wrapper.updateMatrixWorld(true);const current=tip.getWorldPosition(new THREE.Vector3());wrapper.position.add(new THREE.Vector3((left?-1:1)*(pressed?.025:.14)+(pointer.x-.5)*.16,-.48+(pointer.y-.5)*.16,0).sub(current));}
      });
      renderer.autoClear=false;renderer.clearDepth();renderer.render(scene,camera);renderer.autoClear=true;
    },
    dispose(){disposed=true;materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());}
  };
}
