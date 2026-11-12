import {GestureGate,FlowerStroke} from './gesture-math.js';
import {PetalEffects} from './petal-effects.js';
import {FlowerDrawing} from './flower-drawing.js';
const EDGES=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

export class HandGestures {
  constructor({getOrigins,onStop,onAnchor,canDraw=()=>true}){
    this.canDraw=canDraw;this.sampler=new FlowerStroke();this.viewport=document.querySelector('#viewport');
    this.getOrigins=getOrigins;this.onStop=onStop;this.gate=new GestureGate();this.sequence=0;this.running=false;this.loading=false;
    this.video=document.querySelector('#hand-video');this.canvas=document.querySelector('#hand-landmarks');this.status=document.querySelector('#hand-status');
    this.enable=document.querySelector('#hand-enable');
    this.enable.addEventListener('click',()=>this.running||this.loading?this.disable():this.start());
    document.querySelector('#bloom-preview').addEventListener('click',async()=>{
      try {await this.ensureEffects().audio.unlock();this.bloom();} catch(e){this.status.textContent='花瓣预览未能启动：'+e.message;}
    });
    document.querySelector('#bloom-stop').addEventListener('click',()=>this.stopBloom());
    document.querySelector('#bloom-origin').addEventListener('click',()=>onAnchor());
    document.querySelector('#bloom-sound').addEventListener('change',async event=>{
      const audio=this.ensureEffects().audio;audio.setEnabled(event.target.checked);if(event.target.checked)try{await audio.unlock()}catch{}
    });
    document.querySelector('#bloom-volume').addEventListener('input',event=>this.effects?.audio.setVolume(Number(event.target.value)));
    document.querySelector('#flower-mouse').addEventListener('click',async()=>{
      const enabled=!this.mouseMode;this.disable();this.setMouseMode(enabled);
      if(enabled)try{await this.ensureEffects().audio.unlock()}catch{}
    });
    document.querySelector('#flower-undo').addEventListener('click',()=>{this.endDrawing();this.drawing?.undo();});
    document.querySelector('#flower-clear').addEventListener('click',()=>{this.endDrawing();this.drawing?.clear();});
    window.addEventListener('pointerdown',event=>{
      if(!this.mouseMode||event.button!==0||!this.viewport.contains(event.target)||event.target.closest('button,input,select,a'))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(!this.canDraw()){this.status.textContent='请先导入或显示一幅原画';return;}
      this.pointerId=event.pointerId;this.viewport.setPointerCapture(event.pointerId);this.beginDrawing();this.mouseSample(event);
    },true);
    window.addEventListener('pointermove',event=>{
      if(!this.mouseMode||event.pointerId!==this.pointerId)return;
      event.preventDefault();event.stopImmediatePropagation();this.mouseSample(event);
    },true);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])window.addEventListener(type,event=>{
      if(event.pointerId!==this.pointerId)return;event.stopImmediatePropagation();this.endDrawing();
    },true);
    window.addEventListener('keydown',event=>{if(event.key==='Escape'){this.disable();this.stopBloom(true);}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.disable();this.stopBloom(true);}});
    window.addEventListener('pagehide',()=>{this.disable();this.stopBloom(true);});
  }
  ensureDrawing(){
    if(!this.drawing)this.drawing=new FlowerDrawing(this.viewport,{
      onFlower:()=>this.ensureEffects().audio.jade(),
      onChange:(count,full)=>{document.querySelector('#flower-count').textContent=`${count} / 96 朵${full?' · 已满，可撤销或清空':''}`;document.querySelector('#flower-undo').disabled=!count;document.querySelector('#flower-clear').disabled=!count;}
    });
    return this.drawing;
  }
  setMouseMode(enabled){this.mouseMode=enabled;this.endDrawing();document.querySelector('#flower-mouse').textContent=enabled?'退出鼠标试画':'鼠标试画';document.querySelector('#flower-mouse').setAttribute('aria-pressed',String(enabled));this.viewport.classList.toggle('flower-mouse-mode',enabled);if(enabled)this.status.textContent='在原画上按住左键绘花 · Esc 退出试画';}
  beginDrawing(){this.stopBloom();this.gate.reset();this.sampler.end();this.ensureDrawing().begin();this.drawingActive=true;}
  endDrawing(){this.drawingActive=false;this.pointSince=null;this.sampler.end();this.drawing?.showCursor(null);const id=this.pointerId;this.pointerId=null;if(id!=null&&this.viewport.hasPointerCapture(id))this.viewport.releasePointerCapture(id);}
  sample(tip,time){const r=this.viewport.getBoundingClientRect(),result=this.sampler.update(tip,time,r.width,r.height),drawing=this.ensureDrawing();drawing.showCursor(result.cursor);for(const point of result.points)drawing.add(point);}
  mouseSample(event){const r=this.viewport.getBoundingClientRect();this.sample({x:1-(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height},performance.now());}
  handlePoint(state,hands,time){
    if(state.kind!=='point'||!this.canDraw()){this.endDrawing();return;}
    if(!this.drawingActive){this.pointSince??=time;if(time-this.pointSince<100)return;this.beginDrawing();}
    this.sample(hands[0].landmarks[8],time);
    this.status.textContent='食指绘花中 · 握拳结束，花朵保留';
  }
  serializeDrawing(){return this.drawing?.serialize()??[];}
  restoreDrawing(records){if(Array.isArray(records)&&records.length)this.ensureDrawing().restore(records);}
  drawingOverlays(){return this.drawing?.flowers.length?[this.drawing.overlay()]:[];}
  ensureEffects(){
    if(!this.effects){this.effects=new PetalEffects({getOrigins:this.getOrigins,onState:active=>{
      document.querySelector('#bloom-stop').disabled=!active;
      document.querySelector('#bloom-preview').textContent=active?'花开中…':'鼠标预览花开';
    }});this.effects.audio.setEnabled(document.querySelector('#bloom-sound').checked);this.effects.audio.setVolume(Number(document.querySelector('#bloom-volume').value));}
    return this.effects;
  }
  bloom(){
    this.setMouseMode(false);
    const success=this.ensureEffects().start();
    this.status.textContent=success?'花开中 · 握拳停止生成':'请先选中一个可见、未锁定的花篮图层';
  }
  stopBloom(immediate=false){this.effects?.stop(immediate);this.onStop?.();}
  async start(){
    this.setMouseMode(false);
    if(!navigator.mediaDevices?.getUserMedia){this.status.textContent='请用本机启动程序打开，浏览器需支持摄像头访问。';return;}
    const sequence=++this.sequence;this.loading=true;this.enable.textContent='取消开启摄像头';this.status.textContent='请在浏览器中允许摄像头（不请求麦克风）';
    try {
      try{await this.ensureEffects().audio.unlock()}catch{this.status.textContent='音效暂不可用，可静音使用手势';}
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}}});
      if(sequence!==this.sequence){stream.getTracks().forEach(track=>track.stop());return;}
      this.stream=stream;this.video.srcObject=stream;await this.video.play();
      this.status.textContent='正在加载本地 21 点识别模型…';
      const {FilesetResolver,HandLandmarker}=await import('./vendor/mediapipe/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe',import.meta.url).href);
      if(sequence!==this.sequence)return;
      const tracker=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/mediapipe/hand_landmarker.task',import.meta.url).href,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.7,minHandPresenceConfidence:.75,minTrackingConfidence:.7});
      if(sequence!==this.sequence){tracker.close();return;}
      this.tracker=tracker;this.running=true;this.loading=false;this.enable.textContent='关闭摄像头';this.gate.reset();this.lastVideoTime=-1;
      stream.getVideoTracks()[0].addEventListener('ended',()=>this.disable());this.detect();
    } catch(error){
      if(sequence!==this.sequence)return;
      this.disable();
      const messages={NotAllowedError:'摄像头权限未允许，请在浏览器地址栏授权后重试。',NotFoundError:'未找到摄像头，可先用鼠标预览花开。',NotReadableError:'摄像头被其他程序占用，请关闭占用程序后重试。'};
      this.status.textContent=messages[error.name]||`识别未启动：${error.message}。请确认离线包的 vendor/mediapipe 完整。`;
    }
  }
  detect(){
    if(!this.running)return;
    try {
      if(this.video.readyState>=2&&this.video.currentTime!==this.lastVideoTime){
        this.lastVideoTime=this.video.currentTime;
        const result=this.tracker.detectForVideo(this.video,performance.now());
        this.draw(result.landmarks);
        const hands=result.landmarks.map((landmarks,i)=>({landmarks,confidence:result.handedness[i]?.[0]?.score??0}));
        const state=this.gate.update(hands,performance.now());
        document.querySelector('#hand-progress').value=state.progress||0;
        const labels={open:'五指张开 · 稳定保持 0.3 秒',fist:'握拳 · 已结束绘花与花开',point:'仅伸食指 · 准备绘花',peace:state.cleared?'比耶 · 绘花已清空，原画保留':'食指＋中指比耶 · 保持 0.4 秒清空绘花',other:'食指绘花 · 比耶清空 · 握拳停止',uncertain:'手部不清晰，请改善光线或稍微靠近',multiple:'检测到多只手 · 请只保留一只手',missing:'未检测到手 · 将手掌放入画面'};
        this.status.textContent=this.effects?.emitting?'花开中 · 握拳停止生成':labels[state.kind];
        if(state.stop)this.stopBloom();
        if(state.trigger)this.bloom();
        this.handlePoint(state,hands,performance.now());
        if(state.clearDrawing){this.stopBloom();this.drawing?.clear();this.status.textContent=labels.peace;}
      }
      this.timer=setTimeout(()=>this.detect(),65);
    }catch(error){this.disable();this.status.textContent='识别中断，请重新开启摄像头：'+error.message;}
  }
  draw(hands){
    const ctx=this.canvas.getContext('2d');ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    const x=p=>(1-p.x)*this.canvas.width,y=p=>p.y*this.canvas.height;
    ctx.lineWidth=1.5;ctx.strokeStyle='#c7a567';ctx.fillStyle='#f9ebc8';
    for(const points of hands){for(const [a,b]of EDGES){ctx.beginPath();ctx.moveTo(x(points[a]),y(points[a]));ctx.lineTo(x(points[b]),y(points[b]));ctx.stroke();}
      points.forEach((p,i)=>{ctx.beginPath();ctx.arc(x(p),y(p),2.5,0,Math.PI*2);ctx.fill();ctx.font='8px sans-serif';ctx.fillText(String(i),x(p)+4,y(p)-3);});}
  }
  disable(){
    this.setMouseMode(false);
    ++this.sequence;this.running=false;this.loading=false;clearTimeout(this.timer);this.gate.reset();this.stopBloom();
    const stream=this.stream;this.stream=null;stream?.getTracks().forEach(track=>track.stop());
    this.video.pause();this.video.srcObject=null;this.tracker?.close();this.tracker=null;
    this.canvas.getContext('2d').clearRect(0,0,this.canvas.width,this.canvas.height);
    this.enable.textContent='开启摄像头手势';this.status.textContent='摄像头已关闭 · 图像仅在本机处理';document.querySelector('#hand-progress').value=0;
  }
}
