import * as THREE from './vendor/three-0.160.1.js';
const MAX_FLOWERS=96,PALETTE=['#bca3a5','#c9b7a0','#aeb5a2','#d3c3aa'];

// This is a separate composited layer. CSS/globalAlpha=.30 caps the WHOLE
// layer's opacity, even where many petals/flowers overlap.
export class FlowerDrawing {
  constructor(viewport,{onFlower,onChange}){
    this.viewport=viewport;this.onFlower=onFlower;this.onChange=onChange;this.flowers=[];this.stroke=0;this.frame=null;this.opacity=.3;
    this.canvas=document.createElement('canvas');this.canvas.className='flower-drawing-overlay';this.canvas.style.opacity=this.opacity;this.canvas.setAttribute('aria-hidden','true');viewport.append(this.canvas);
    this.cursor=document.createElement('div');this.cursor.className='finger-cursor';this.cursor.hidden=true;this.cursor.setAttribute('aria-hidden','true');viewport.append(this.cursor);
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.setClearColor(0,0);
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(40,1,1,2000);this.camera.position.z=1000;
    // Tessellated cupped surface, not a flat flower sprite. Interior vertices
    // retain curvature and smooth normals as each petal opens in 3D.
    const geometry=new THREE.BufferGeometry(),vertices=[],indices=[],cols=12,rows=20;
    for(let row=0;row<=rows;row++)for(let col=0;col<=cols;col++){
      const v=row/rows,u=col/cols*2-1,envelope=Math.pow(Math.sin(v*Math.PI),.72);
      vertices.push(u*.62*envelope,v*1.8,.32*Math.sin(v*Math.PI)+.18*v*v+.23*u*u*envelope);
    }
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const a=row*(cols+1)+col,b=a+1,c=a+cols+1,d=c+1;indices.push(a,b,c,b,d,c);
    }
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    this.look=new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS*10*4),4);geometry.setAttribute('flowerLook',this.look);
    this.petals=new THREE.InstancedMesh(geometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:`attribute vec4 flowerLook;varying vec4 tint;varying vec2 uvPetal;varying float lightness;void main(){tint=flowerLook;uvPetal=position.xy;vec3 n=normalize(mat3(instanceMatrix)*normal);lightness=.66+.34*max(0.,dot(n,normalize(vec3(-.5,.65,1.))));gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
      fragmentShader:`precision highp float;varying vec4 tint;varying vec2 uvPetal;varying float lightness;void main(){float vein=exp(-abs(uvPetal.x)*26.)*.045;float tip=smoothstep(.2,1.8,uvPetal.y);vec3 c=mix(tint.rgb*.78,tint.rgb+vec3(.08),tip)*lightness-vein;float a=tint.a*(.65+.35*smoothstep(0.,.5,uvPetal.y));gl_FragColor=vec4(c,a);}`}),MAX_FLOWERS*10);
    this.petals.frustumCulled=false;this.scene.add(this.petals);
    this.cores=new THREE.InstancedMesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshStandardMaterial({color:'#baaa7c',roughness:.95,metalness:0,transparent:true,opacity:.9}),MAX_FLOWERS);
    this.cores.frustumCulled=false;this.scene.add(this.cores);this.scene.add(new THREE.HemisphereLight('#fff3dc','#736a59',2));
    const sun=new THREE.DirectionalLight('#fff1d5',2);sun.position.set(-2,3,5);this.scene.add(sun);
    this.flowerRoot=new THREE.Object3D();this.petalMatrix=new THREE.Matrix4();
    const geo=new THREE.BufferGeometry();this.haloPosition=new THREE.BufferAttribute(new Float32Array(MAX_FLOWERS*13*3),3);this.haloLook=new THREE.BufferAttribute(new Float32Array(MAX_FLOWERS*13*2),2);geo.setAttribute('position',this.haloPosition);geo.setAttribute('haloLook',this.haloLook);
    this.halo=new THREE.Points(geo,new THREE.ShaderMaterial({transparent:true,depthWrite:false,
      vertexShader:`attribute vec2 haloLook;varying float alpha;void main(){alpha=haloLook.y;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=haloLook.x;gl_Position=projectionMatrix*p;}`,
      fragmentShader:`precision highp float;varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;float a=exp(-r*r*4.)*(1.-smoothstep(.65,1.,r))*alpha;gl_FragColor=vec4(.82,.71,.47,a);}`}));
    this.halo.frustumCulled=false;this.scene.add(this.halo);this.dummy=new THREE.Object3D();
    this.resize=()=>{const r=viewport.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();this.scale=2*Math.tan(20*Math.PI/180)*1000/this.height;this.renderer.setSize(this.width,this.height,false);this.requestRender();};
    this.observer=new ResizeObserver(this.resize);this.observer.observe(viewport);this.resize();
  }
  begin(){this.stroke++;}
  showCursor(point){this.cursor.hidden=!point;if(point){this.cursor.style.left=`${point.x*100}%`;this.cursor.style.top=`${point.y*100}%`;}}
  add(point){
    if(this.flowers.length>=MAX_FLOWERS){this.onChange?.(this.flowers.length,true);return false;}
    if(this.flowers.some(f=>Math.hypot((f.x-point.x)*this.width,(f.y-point.y)*this.height)<28))return false;
    // Bias toward small blooms, with occasional large accents. Choose once at
    // birth so size is stable during animation and survives project export.
    const radius=Math.max(.006,Math.min(.1,(8+24*Math.pow(Math.random(),1.4))/Math.min(this.width,this.height)));
    this.flowers.push({x:point.x,y:point.y,radius,rotation:Math.random()*Math.PI*2,color:Math.floor(Math.random()*PALETTE.length),born:performance.now(),stroke:this.stroke});
    this.onFlower?.();this.onChange?.(this.flowers.length,false);this.requestRender();return true;
  }
  requestRender(){if(!this.frame)this.frame=requestAnimationFrame(time=>{this.frame=null;this.render(time);});}
  render(time=performance.now()){
    let petals=0,points=0,cores=0,animating=false;
    for(const f of this.flowers){
      const age=Math.max(0,(time-f.born)/1000),progress=Math.min(1,age/1.8),bloom=progress*progress*(3-2*progress);if(age<4)animating=true;
      const radius=f.radius*Math.min(this.width,this.height)*this.scale,x=(f.x-.5)*this.width*this.scale,y=(.5-f.y)*this.height*this.scale;
      const color=new THREE.Color(PALETTE[f.color]);
      this.flowerRoot.position.set(x,y,0);this.flowerRoot.rotation.set(.28*Math.sin(f.rotation),.23*Math.cos(f.rotation),0);this.flowerRoot.updateMatrix();
      for(let ring=0;ring<2;ring++)for(let petal=0;petal<5;petal++){
        const angle=f.rotation+petal*Math.PI*2/5+ring*.6;
        this.dummy.position.set(0,0,ring*radius*.16);this.dummy.rotation.set((1-bloom)*1.12+(ring?.3:.03),0,angle);
        this.dummy.scale.setScalar(radius*(ring?.65:1)*(.22+.78*bloom)*(1+.07*Math.sin(petal*2.4+f.rotation)));this.dummy.updateMatrix();
        this.petalMatrix.multiplyMatrices(this.flowerRoot.matrix,this.dummy.matrix);this.petals.setMatrixAt(petals,this.petalMatrix);
        this.look.setXYZW(petals,color.r,color.g,color.b,Math.min(1,age/.2)*.88);petals++;
      }
      const coreScale=radius*(.07+.1*bloom)*Math.min(1,age/.2);
      this.dummy.position.set(0,0,radius*.23);this.dummy.rotation.set(0,0,0);this.dummy.scale.set(coreScale,coreScale,coreScale*.65);this.dummy.updateMatrix();
      this.petalMatrix.multiplyMatrices(this.flowerRoot.matrix,this.dummy.matrix);this.cores.setMatrixAt(cores++,this.petalMatrix);
      for(let i=0;i<13;i++){
        const a=i/12*Math.PI*2+Math.min(age,4)*.22,reach=i===12?0:radius*(1.9+.25*bloom);
        this.haloPosition.setXYZ(points,x+Math.cos(a)*reach,y+Math.sin(a)*reach,4);
        this.haloLook.setXY(points,i===12?9:4+Math.sin(i*2)*1.5,i===12?.65:Math.max(.07,.38*Math.exp(-age*.6)));points++;
      }
    }
    this.petals.count=petals;this.petals.instanceMatrix.needsUpdate=true;this.cores.count=cores;this.cores.instanceMatrix.needsUpdate=true;this.look.needsUpdate=true;this.halo.geometry.setDrawRange(0,points);this.haloPosition.needsUpdate=true;this.haloLook.needsUpdate=true;this.renderer.render(this.scene,this.camera);
    if(animating)this.requestRender();
  }
  undo(){const last=this.flowers.at(-1)?.stroke;this.flowers=this.flowers.filter(f=>f.stroke!==last);this.onChange?.(this.flowers.length,false);this.requestRender();}
  clear(){this.flowers=[];this.showCursor(null);this.onChange?.(0,false);this.requestRender();}
  serialize(){return this.flowers.map(({born,...f})=>f);}
  restore(records){
    if(!Array.isArray(records))return;
    const offset=this.stroke+1;
    for(const f of records.slice(0,MAX_FLOWERS-this.flowers.length)){
      if(!f||![f.x,f.y,f.radius,f.rotation,f.color,f.stroke].every(Number.isFinite)||f.x<0||f.x>1||f.y<0||f.y>1)continue;
      this.flowers.push({x:f.x,y:f.y,radius:Math.max(.006,Math.min(.1,f.radius)),rotation:f.rotation,color:Math.abs(Math.floor(f.color))%PALETTE.length,stroke:offset+Math.max(0,Math.floor(f.stroke)),born:performance.now()-5000});
    }
    this.stroke=Math.max(offset,...this.flowers.map(f=>f.stroke));this.onChange?.(this.flowers.length,false);this.requestRender();
  }
  overlay(){this.render();return {canvas:this.canvas,opacity:this.opacity};}
}
