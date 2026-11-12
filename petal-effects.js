import * as THREE from './vendor/three-0.160.1.js';

// Procedural audio: pentatonic plucked strings and a quiet filtered rustle.
// No microphone access, recordings, external audio or copyrighted samples.
class BloomAudio {
  constructor(){this.enabled=true;this.volume=.18;this.voices=new Set();}
  async unlock(){
    if(!this.enabled)return;
    this.context ||= new (window.AudioContext||window.webkitAudioContext)();
    if(!this.master){
      this.master=this.context.createGain();this.master.gain.value=this.volume;
      const limiter=this.context.createDynamicsCompressor();limiter.threshold.value=-20;limiter.ratio.value=5;
      this.master.connect(limiter);limiter.connect(this.context.destination);
    }
    await this.context.resume();
  }
  setVolume(value){this.volume=value;if(this.master)this.master.gain.setTargetAtTime(this.enabled?value:0,this.context.currentTime,.1);}
  setEnabled(enabled){this.enabled=enabled;this.setVolume(this.volume);if(!enabled)this.stop();}
  bloom(){
    if(!this.enabled||!this.context||this.context.state!=='running')return;
    this.stop();
    const ctx=this.context;
    [261.63,293.66,329.63,392,440,523.25].forEach((frequency,index)=>{
      const buffer=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate),out=buffer.getChannelData(0);
      const size=Math.round(ctx.sampleRate/frequency),ring=new Float32Array(size);
      for(let i=0;i<size;i++)ring[i]=(Math.random()*2-1)*.6;
      for(let i=0;i<out.length;i++){const k=i%size;out[i]=ring[k];ring[k]=.497*(ring[k]+ring[(k+1)%size]);}
      this.playBuffer(buffer,ctx.currentTime+index*.14,.16,2.8,(index-2.5)*.12);
    });
    const noise=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),data=noise.getChannelData(0);
    let previous=0;for(let i=0;i<data.length;i++){previous=.93*previous+.07*(Math.random()*2-1);data[i]=previous;}
    const source=ctx.createBufferSource(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
    source.buffer=noise;source.loop=true;filter.type='bandpass';filter.frequency.value=1500;filter.Q.value=.5;
    gain.gain.setValueAtTime(0,ctx.currentTime);gain.gain.linearRampToValueAtTime(.14,ctx.currentTime+.5);
    source.connect(filter);filter.connect(gain);gain.connect(this.master);source.start();
    this.rustle={source,gain,filter};
  }
  playBuffer(buffer,start,volume,duration,pan){
    const ctx=this.context,source=ctx.createBufferSource(),gain=ctx.createGain(),panner=ctx.createStereoPanner();
    source.buffer=buffer;panner.pan.value=pan;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    source.connect(gain);gain.connect(panner);panner.connect(this.master);const voice={source,gain,panner};this.voices.add(voice);
    source.onended=()=>{source.disconnect();gain.disconnect();panner.disconnect();this.voices.delete(voice)};
    source.start(start);source.stop(start+duration+.05);
  }
  jade(){
    if(!this.enabled||!this.context||this.context.state!=='running'||this.voices.size>28)return;
    const ctx=this.context,length=Math.floor(ctx.sampleRate*.65),buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0);
    const root=[880,988,1175,1320][Math.floor(Math.random()*4)];
    for(let i=0;i<length;i++){const t=i/ctx.sampleRate,attack=Math.min(1,t/.005);data[i]=attack*(Math.sin(t*root*Math.PI*2)*Math.exp(-t*9)+.25*Math.sin(t*root*2.73*Math.PI*2)*Math.exp(-t*18));}
    this.playBuffer(buffer,ctx.currentTime,.045,.6,(Math.random()-.5)*.3);
  }
  stop(){
    if(!this.context)return;const now=this.context.currentTime;
    for(const voice of this.voices){voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.07);try{voice.source.stop(now+.3)}catch{}}
    if(this.rustle){const {source,gain,filter}=this.rustle;gain.gain.setTargetAtTime(0,now,.08);source.stop(now+.4);source.onended=()=>{source.disconnect();gain.disconnect();filter.disconnect()};this.rustle=null;}
  }
}

export class PetalEffects {
  constructor({getOrigins,onState}){
    this.getOrigins=getOrigins;this.onState=onState;this.audio=new BloomAudio();this.items=[];this.emitting=false;this.frame=null;this.last=0;this.accumulator=0;
    this.canvas=document.createElement('canvas');this.canvas.className='petal-overlay';this.canvas.setAttribute('aria-hidden','true');
    document.body.append(this.canvas);
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,alpha:true,antialias:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.setClearColor(0,0);
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(45,1,1,2000);this.camera.position.z=1000;
    const shape=new THREE.Shape();shape.moveTo(0,-1);shape.bezierCurveTo(-.8,-.45,-.8,.7,0,1);shape.bezierCurveTo(.8,.7,.8,-.45,0,-1);
    const geometry=new THREE.ShapeGeometry(shape,9),positions=geometry.attributes.position;
    for(let i=0;i<positions.count;i++){const x=positions.getX(i),y=positions.getY(i);positions.setZ(i,.24*x*x+.16*Math.sin(y*2));}geometry.computeVertexNormals();
    const count=240;this.petals=new THREE.InstancedMesh(geometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:`attribute vec4 petalLook; varying vec4 tint; varying vec2 uvPetal; varying float lightness;
      void main(){tint=petalLook;uvPetal=position.xy;vec3 n=normalize(mat3(instanceMatrix)*normal);lightness=.78+.22*abs(dot(n,normalize(vec3(.3,.5,1.))));gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
      fragmentShader:`precision highp float;varying vec4 tint;varying vec2 uvPetal;varying float lightness;
      void main(){float vein=exp(-abs(uvPetal.x)*26.)*.06;vec3 c=tint.rgb*lightness-vein;float a=tint.a*(.65+.35*(1.-abs(uvPetal.y)));gl_FragColor=vec4(c,a);}`}),count);
    this.look=new THREE.InstancedBufferAttribute(new Float32Array(count*4),4);geometry.setAttribute('petalLook',this.look);this.petals.count=0;this.petals.frustumCulled=false;this.scene.add(this.petals);
    const goldGeo=new THREE.BufferGeometry();this.goldPositions=new THREE.BufferAttribute(new Float32Array(450*3),3);this.goldLife=new THREE.BufferAttribute(new Float32Array(450*2),2);goldGeo.setAttribute('position',this.goldPositions);goldGeo.setAttribute('goldLife',this.goldLife);
    this.gold=new THREE.Points(goldGeo,new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`attribute vec2 goldLife;varying float alpha;void main(){vec4 p=modelViewMatrix*vec4(position,1.);alpha=goldLife.y;gl_PointSize=min(26.,goldLife.x*1000./max(150.,-p.z));gl_Position=projectionMatrix*p;}`,
      fragmentShader:`precision highp float;varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;float a=exp(-r*r*4.5)*(1.-smoothstep(.6,1.,r))*alpha;gl_FragColor=vec4(.86,.64,.30,a*.24);}`}));
    this.gold.frustumCulled=false;this.scene.add(this.gold);this.dummy=new THREE.Object3D();
    this.resize=()=>{this.width=innerWidth;this.height=innerHeight;this.renderer.setSize(this.width,this.height,false);this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();this.pixelScale=2*Math.tan(Math.PI/8)*1000/this.height;};
    this.resize();window.addEventListener('resize',this.resize);
    document.addEventListener('fullscreenchange',()=>{(document.fullscreenElement||document.body).append(this.canvas);this.resize();});
  }
  start(){
    if(this.emitting)return true;
    if(!this.getOrigins().length)return false;
    this.emitting=true;this.stopDeadline=null;this.accumulator=0;this.audio.bloom();
    for(let i=0;i<70;i++)this.spawn(i%3===0?'gold':'petal');
    this.onState?.(true);this.last=performance.now();if(!this.frame)this.frame=requestAnimationFrame(t=>this.tick(t));return true;
  }
  stop(immediate=false){
    if(this.emitting || this.stopDeadline==null)this.stopDeadline=performance.now()+750;
    this.emitting=false;this.audio.stop();this.onState?.(false);
    if(immediate){this.items=[];cancelAnimationFrame(this.frame);this.frame=null;this.renderer.clear();}
    // Existing petals finish a short, quiet fade; no new particles are born.
    else for(const item of this.items)item.life=Math.min(item.life,item.age+.7);
  }
  spawn(kind){
    const max=kind==='petal'?240:450;if(this.items.filter(p=>p.kind===kind).length>=max)return;
    const origins=this.getOrigins();if(!origins.length)return;const p=origins[Math.floor(Math.random()*origins.length)],angle=Math.random()*Math.PI*2;
    const radius=Math.random()*24,scale=this.pixelScale;
    this.items.push({kind,position:new THREE.Vector3((p.x-this.width/2+Math.cos(angle)*radius)*scale,(this.height/2-p.y+Math.sin(angle)*radius)*scale,0),
      velocity:new THREE.Vector3(Math.cos(angle)*(50+Math.random()*110)*scale,(20+Math.sin(angle)*70)*scale,70+Math.random()*110),
      age:0,life:4+Math.random()*2,rotation:new THREE.Vector3(Math.random()*6,Math.random()*6,angle),spin:new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5),
      size:(kind==='petal'?7+Math.random()*13:4+Math.random()*7)*scale,tint:new THREE.Color(['#d7a6ae','#e4c4ba','#eee0c5','#c7caaa'][Math.floor(Math.random()*4)]),seed:Math.random()*8});
  }
  tick(time){
    this.frame=null;const dt=Math.min((time-this.last)/1000,.05);this.last=time;
    if(!this.emitting && this.stopDeadline!==null && time>=this.stopDeadline)this.items=[];
    if(this.emitting){this.accumulator+=dt*90;while(this.accumulator>=1){this.spawn(Math.random()<.52?'gold':'petal');this.accumulator--;}}
    let petals=0,gold=0;this.items=this.items.filter(p=>p.age<p.life&&p.position.z<850);
    for(const p of this.items){p.age+=dt;p.position.addScaledVector(p.velocity,dt);p.position.x+=Math.sin(p.age*1.4+p.seed)*dt*12*this.pixelScale;p.rotation.addScaledVector(p.spin,dt*2);
      const alpha=Math.min(1,p.age/.18)*Math.min(1,(p.life-p.age)/1.2)*.65;
      if(p.kind==='petal'){
        this.dummy.position.copy(p.position);this.dummy.rotation.set(p.rotation.x,p.rotation.y,p.rotation.z);this.dummy.scale.setScalar(p.size);this.dummy.updateMatrix();this.petals.setMatrixAt(petals,this.dummy.matrix);this.look.setXYZW(petals,p.tint.r,p.tint.g,p.tint.b,Math.max(0,alpha));petals++;
      }else{this.goldPositions.setXYZ(gold,p.position.x,p.position.y,p.position.z);this.goldLife.setXY(gold,p.size,Math.max(0,alpha));gold++;}
    }
    this.petals.count=petals;this.petals.instanceMatrix.needsUpdate=true;this.look.needsUpdate=true;this.gold.geometry.setDrawRange(0,gold);this.goldPositions.needsUpdate=true;this.goldLife.needsUpdate=true;
    this.renderer.render(this.scene,this.camera);
    if(this.emitting||this.items.length)this.frame=requestAnimationFrame(t=>this.tick(t));
  }
}
