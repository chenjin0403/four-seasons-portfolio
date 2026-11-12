// Pure geometry and temporal gate, independent of camera/renderer for testing.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
function angle(a,b,c) {
  const u=[a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0)],v=[c.x-b.x,c.y-b.y,(c.z||0)-(b.z||0)];
  const norm=Math.hypot(...u)*Math.hypot(...v);
  return norm ? Math.acos(Math.max(-1,Math.min(1,u.reduce((s,n,i)=>s+n*v[i],0)/norm)))*180/Math.PI : 0;
}
export function classifyHand(points, confidence=1) {
  if(points?.length!==21 || confidence<0.7 || points.some(p=>![p.x,p.y,p.z??0].every(Number.isFinite))) return {kind:'uncertain'};
  const width=distance(points[5],points[17]);
  if(width<0.035) return {kind:'uncertain'};
  const extended=[],curled=[];
  for(const base of [5,9,13,17]) {
    const [mcp,pip,dip,tip]=points.slice(base,base+4);
    extended.push(angle(mcp,pip,dip)>155 && angle(pip,dip,tip)>150 && distance(tip,points[0])>distance(pip,points[0])*1.12);
    curled.push(angle(mcp,pip,dip)<135 && distance(tip,points[0])<distance(pip,points[0])*1.12);
  }
  const thumb=angle(points[2],points[3],points[4])>150 && distance(points[4],points[5])>width*0.65;
  const spread=[[4,8,.65],[8,12,.40],[12,16,.34],[16,20,.34]].every(([a,b,r])=>distance(points[a],points[b])>width*r);
  const palmArea=Math.abs((points[5].x-points[0].x)*(points[17].y-points[0].y)-(points[5].y-points[0].y)*(points[17].x-points[0].x));
  const facing=palmArea>width*width*.22;
  const center={x:(points[0].x+points[5].x+points[9].x+points[17].x)/4,y:(points[0].y+points[5].y+points[9].y+points[17].y)/4,z:0};
  const kind=extended.every(Boolean)&&thumb&&spread&&facing ? 'open'
    : curled.every(Boolean)&&!thumb ? 'fist'
    : extended[0]&&extended[1]&&!thumb&&curled[2]&&curled[3]&&distance(points[8],points[12])>width*.4 ? 'peace'
    : extended[0]&&!thumb&&curled.slice(1).every(Boolean) ? 'point' : 'other';
  return {kind,center,width,tips:[4,8,12,16,20].map(i=>points[i])};
}

// A drawing stroke is sampled by distance, not by camera frame count.
export class FlowerStroke {
  constructor(){this.end();}
  end(){this.filtered=null;this.last=null;this.time=null;this.birthTime=-Infinity;}
  update(tip,time,width,height){
    if(!tip||!Number.isFinite(tip.x)||!Number.isFinite(tip.y)||tip.x<0||tip.x>1||tip.y<0||tip.y>1){this.end();return {points:[],cursor:null};}
    const current={x:1-tip.x,y:tip.y};
    if(this.time!==null&&time-this.time>250)this.end();
    const dt=this.time===null?100:Math.max(0,time-this.time);this.time=time;
    const amount=1-Math.exp(-dt/50);
    this.filtered=this.filtered?{x:this.filtered.x+(current.x-this.filtered.x)*amount,y:this.filtered.y+(current.y-this.filtered.y)*amount}:current;
    const cursor={...this.filtered};
    if(!this.last){this.last={...cursor};this.birthTime=time;return {points:[cursor],cursor};}
    const dx=(cursor.x-this.last.x)*width,dy=(cursor.y-this.last.y)*height,distance=Math.hypot(dx,dy),spacing=52;
    if(distance>Math.max(260,width*.3)){this.last={...cursor};return {points:[],cursor};}
    if(distance<spacing||time-this.birthTime<110)return {points:[],cursor};
    const count=Math.min(3,Math.floor(distance/spacing)),start={...this.last},points=[];
    for(let i=1;i<=count;i++)points.push({x:start.x+(cursor.x-start.x)*spacing*i/distance,y:start.y+(cursor.y-start.y)*spacing*i/distance});
    this.last=points.at(-1);this.birthTime=time;return {points,cursor};
  }
}

export class GestureGate {
  constructor(){this.reset();}
  reset(){this.start=null;this.anchor=null;this.latched=false;this.lastSingle=null;this.previousTime=null;this.resetPeace();}
  resetPeace(){this.peaceStart=null;this.peaceAnchor=null;this.peaceLatched=false;}
  update(hands,time) {
    if(this.previousTime!==null && time-this.previousTime>220){this.start=null;this.anchor=null;this.peaceStart=null;this.peaceAnchor=null;}
    this.previousTime=time;
    if(hands.length!==1) {
      this.resetPeace();
      this.start=null;this.anchor=null;
      const stop=hands.length>1 || (this.lastSingle!==null && time-this.lastSingle>500);
      if(stop)this.latched=false;
      return {kind:hands.length>1?'multiple':'missing',progress:0,stop};
    }
    this.lastSingle=time;
    const hand=classifyHand(hands[0].landmarks,hands[0].confidence);
    if(hand.kind!=='peace')this.resetPeace();
    if(hand.kind==='peace'){
      this.start=null;this.anchor=null;this.latched=false;
      const stable=this.peaceAnchor&&distance(hand.center,this.peaceAnchor.center)<this.peaceAnchor.width*.15
        &&hand.width/this.peaceAnchor.width>.82&&hand.width/this.peaceAnchor.width<1.18
        &&hand.tips.every((tip,i)=>distance(tip,this.peaceAnchor.tips[i])<this.peaceAnchor.width*.23);
      if(!stable||this.peaceStart===null){this.peaceStart=time;this.peaceAnchor=hand;}
      const progress=Math.min(1,(time-this.peaceStart)/400),clearDrawing=progress===1&&!this.peaceLatched;
      if(clearDrawing)this.peaceLatched=true;
      return {...hand,progress,clearDrawing,cleared:this.peaceLatched};
    }
    if(hand.kind==='uncertain'){this.start=null;this.anchor=null;this.latched=false;return {...hand,progress:0,stop:true};}
    if(hand.kind==='fist'){this.start=null;this.anchor=null;this.latched=false;return {...hand,progress:0,stop:true};}
    if(hand.kind!=='open'){this.start=null;this.anchor=null;return {...hand,progress:0};}
    const stable=this.anchor && distance(hand.center,this.anchor.center)<this.anchor.width*.15
      && hand.width/this.anchor.width>.82 && hand.width/this.anchor.width<1.18
      && hand.tips.every((tip,i)=>distance(tip,this.anchor.tips[i])<this.anchor.width*.23);
    if(!stable || this.start===null){this.start=time;this.anchor=hand;}
    const progress=Math.min(1,(time-this.start)/300);
    const trigger=progress===1 && !this.latched;
    if(trigger)this.latched=true;
    return {...hand,progress,trigger};
  }
}
