export const PAPER = {
  sky: '#fbe7b2', paper: '#fff6df', shade: '#ead9b4', ink: '#17324a', harbor: '#1b7f86', crest: '#46aaa5',
  brick: '#b9432e', mustard: '#ebaa1f', green: '#7daf5f', deepGreen: '#4f8a55', red: '#da291c', purple: '#80276c',
}

export const shadeChunk = /* glsl */`
uniform vec3 uSky; uniform float uFog; uniform vec3 uCam;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
vec3 flatNormal(vec3 w){ vec3 n=normalize(cross(dFdx(w),dFdy(w))); if(dot(n,uCam-w)<0.) n=-n; return n; }
vec3 paperLight(vec3 color, vec3 n, vec3 w){
  float l=dot(n,normalize(vec3(-.52,.74,.42)));
  #ifdef SMOOTH
  float band=.76+.24*smoothstep(-.25,.8,l);
#else
  float band=l>.62?1.:(l>.22?.87:.72);
#endif
  float grain=noise(w.xz*.55+w.y*.4)*.5+noise(w.xz*3.1+w.y*2.)*.5;
  vec3 c=color*(band+(grain-.5)*.055);
  float d=distance(w,uCam); float f=1.-exp(-pow(d/uFog,2.2));
  return mix(c,uSky,clamp(f,0.,1.));
}
`

export const foldChunk = /* glsl */`
uniform vec3 uReveal; uniform float uSoft; uniform vec4 uRing;
vec3 foldUp(vec3 p, vec2 c, float seed, float base){
  float t=clamp((uReveal.z-distance(c,uReveal.xy)-seed*110.)/uSoft,0.,1.);
  if(t<=0.) return vec3(p.x,base-7.,p.z);
  float e=1.-pow(1.-t,3.); float a=1.5708*(e+sin(t*3.14159)*.14);
  vec2 dir=normalize(c-uReveal.xy+vec2(.013,.021));
  float ring=exp(-pow((distance(c,uRing.xy)-uRing.z)/95.,2.))*uRing.w;
  float h=p.y*(1.+ring*.2);
  return vec3(p.x+dir.x*h*cos(a),base+h*sin(a),p.z-dir.y*h*cos(a));
}
`

export const buildingVert = /* glsl */`
attribute vec2 aC; attribute vec3 aM;
uniform float uBase;
${foldChunk}
varying vec3 vW; varying vec3 vP; varying vec3 vM; varying vec2 vC;
void main(){
  vec3 w=foldUp(position,aC,aM.y,uBase);
  vW=w; vP=vec3(position.x-aC.x,position.y,position.z+aC.y); vM=aM; vC=aC; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
}`

const tone = /* glsl */`
uniform vec4 uFocus; uniform float uColor;
vec3 tone(vec3 color, vec2 c){
  float f=smoothstep(uFocus.z,uFocus.z*.62,distance(c,uFocus.xy))*uFocus.w;
  return mix(vec3(.985,.95,.86),color,clamp(uColor+f*.8-(uFocus.w*.24),0.,1.));
}`

export const buildingFrag = /* glsl */`
precision highp float;
varying vec3 vW; varying vec3 vP; varying vec3 vM; varying vec2 vC;
${tone}
${shadeChunk}
vec3 pick(float s, vec3 a, vec3 b, vec3 c, vec3 d){ return s<.25?a:(s<.5?b:(s<.75?c:d)); }
float box(vec2 p, vec2 a, vec2 b, vec2 w){ vec2 s=smoothstep(a-w,a+w,p)*(1.-smoothstep(b-w,b+w,p)); return s.x*s.y; }
void main(){
  vec3 nW=flatNormal(vW); vec3 nP=normalize(cross(dFdx(vP),dFdy(vP)));
  float type=floor(vM.x+.5), s=vM.y, H=vM.z, y=vP.y, ny=abs(nP.y);
  vec3 wall=vec3(.96,.9,.78);
  if(type==1.) wall=pick(s,vec3(.96,.88,.72),vec3(.68,.82,.79),vec3(.94,.75,.58),vec3(.98,.94,.83));
  else if(type==2.) wall=pick(s,vec3(.93,.78,.53),vec3(.97,.92,.78),vec3(.58,.77,.74),vec3(.9,.64,.49));
  else if(type==3.) wall=pick(s,vec3(.93,.68,.19),vec3(.82,.39,.27),vec3(.25,.6,.59),vec3(.96,.85,.58));
  else if(type==4.) wall=pick(s,vec3(.74,.36,.26),vec3(.84,.56,.39),vec3(.92,.82,.65),vec3(.5,.63,.63));
  else if(type==5.) wall=pick(s,vec3(.71,.24,.17),vec3(.79,.35,.23),vec3(.92,.7,.3),vec3(.62,.29,.23));
  else if(type==6.) wall=pick(s,vec3(.56,.74,.72),vec3(.86,.83,.71),vec3(.43,.63,.64),vec3(.78,.8,.71));
  else if(type==7.) wall=vec3(.7,.68,.6);
  vec3 color=wall; float d=distance(vW,uCam);
  if(ny>.92) color=mix(vec3(.3,.38,.42),vec3(.72,.7,.62),fract(s*5.));
  else if(ny>.28) color=pick(fract(s*7.),vec3(.22,.31,.4),vec3(.62,.23,.16),vec3(.34,.44,.39),vec3(.42,.36,.34));
  else {
    vec2 t=normalize(vec2(-nP.z,nP.x)+1e-5); float along=dot(vP.xz,t);
    if(y>H-1.35&&type!=1.&&type!=2.) color=mix(wall,vec3(1.,.97,.88),.72);
    if(y<1.) color*=.74;
    float fade=1.-smoothstep(190.,520.,d);
    if(fade>.01){
      float lap=y*1.55; if(type>=1.&&type<=3.) color*=1.-.04*step(.5,fract(lap))*fade*(1.-smoothstep(.2,.45,fwidth(lap)));
      float top=(type<=2.&&H<18.)?H*.66:H-1.25;
      float floors=type==3.?3.:max(1.,floor((top-1.05)/(type==5.?4.9:(type<=2.?3.7:4.5))));
      float floorH=(top-1.05)/floors, bayW=type==3.?3.3:(type<=2.?4.2:3.9);
      vec2 c=vec2(along/bayW,(y-1.05)/floorH), f=fract(c), id=floor(c), w=fwidth(c)*.75;
      float vis=fade*(1.-smoothstep(.16,.42,max(w.x,w.y)));
      float ok=step(0.,c.y)*step(c.y,floors);
      if(type==8.) ok=0.; if(type==7.) ok*=step(.62,hash(vec2(id.x,floor(s*211.+.5)*.53)));
      float frame=box(f,vec2(.2,.16),vec2(.8,.84),w)*ok, glass=box(f,vec2(.27,.23),vec2(.73,.77),w)*ok;
      if(type==5.&&id.y<.5){ frame=box(f,vec2(.04,.05),vec2(.96,.74),w)*ok; glass=box(f,vec2(.08,.09),vec2(.92,.7),w)*ok; }
      if(type==3.) color=mix(color,vec3(1.,.97,.88),(1.-smoothstep(.05,.05+w.y*2.,f.y))*ok*vis*.9);
      float S=floor(s*211.+.5); float lit=hash(id+S*.37); vec3 pane=lit>.84?vec3(.99,.8,.34):mix(vec3(.15,.28,.38),vec3(.3,.49,.54),hash(id+S*.91));
      color=mix(color,vec3(1.,.97,.88),frame*vis); color=mix(color,pane,glass*vis);
    }
  }
  gl_FragColor=vec4(paperLight(tone(color,vC),nW,vW),1.);
}`

export const detailVert = /* glsl */`
attribute vec2 aC; attribute vec3 aM; attribute vec3 aRGB;
uniform float uBase;
${foldChunk}
varying vec3 vW; varying vec3 vRGB; varying vec2 vC;
void main(){ vec3 w=foldUp(position,aC,aM.y,uBase); vW=w; vRGB=aRGB; vC=aC; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.); }`

export const detailFrag = /* glsl */`
precision highp float; varying vec3 vW; varying vec3 vRGB; varying vec2 vC;
${tone}
${shadeChunk}
void main(){ gl_FragColor=vec4(paperLight(tone(vRGB,vC),flatNormal(vW),vW),1.); }`

export const shadowVert = /* glsl */`
attribute vec2 aC; attribute vec3 aM;
uniform float uBase; uniform vec2 uSun;
${foldChunk}
void main(){
  vec3 f=foldUp(position,aC,aM.y,uBase); float h=max(0.,f.y-uBase);
  vec3 w=vec3(f.x+h*uSun.x,uBase+.9,f.z+h*uSun.y);
  gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
}`

export const shadowFrag = /* glsl */`
precision mediump float; uniform float uOpacity;
void main(){ gl_FragColor=vec4(.09,.2,.29,uOpacity); }`

export const paperVert = /* glsl */`
varying vec3 vW; varying vec3 vI;
#ifdef SMOOTH
varying vec3 vN;
#endif
void main(){
  vec4 p=vec4(position,1.);
#ifdef USE_INSTANCING
  p=instanceMatrix*p;
#endif
  vec4 w=modelMatrix*p; vW=w.xyz; vI=vec3(1.);
#ifdef SMOOTH
  vN=normalize(mat3(modelMatrix)*normal);
#endif
#ifdef USE_INSTANCING_COLOR
  vI=instanceColor;
#endif
  gl_Position=projectionMatrix*viewMatrix*w;
}`

export const paperFrag = /* glsl */`
precision highp float; varying vec3 vW; varying vec3 vI; uniform vec3 uColor;
#ifdef SMOOTH
varying vec3 vN;
#endif
${shadeChunk}
void main(){
#ifdef SMOOTH
  vec3 n=normalize(vN);
#else
  vec3 n=flatNormal(vW);
#endif
  gl_FragColor=vec4(paperLight(uColor*vI,n,vW),1.);
}`

export const waterVert = /* glsl */`
varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`

export const waterFrag = /* glsl */`
precision highp float; varying vec3 vW; uniform float uTime; uniform vec3 uA; uniform vec3 uB;
${shadeChunk}
void main(){
  vec2 p=vW.xz*.012; float a=noise(p*.45+uTime*.025)*2.;
  float w=sin(p.y*2.1+p.x*.55+a*2.4+uTime*.28);
  float mask=smoothstep(.76,.8,w);
  float w2=sin(p.y*4.3-p.x*.8+a*3.+uTime*.2+1.4); mask=max(mask,smoothstep(.9,.93,w2)*.55);
  vec3 c=mix(uA,uB,mask);
  gl_FragColor=vec4(paperLight(c,vec3(0.,1.,0.),vW),1.);
}`

export const flagVert = /* glsl */`
uniform float uTime; uniform float uRise; varying vec2 vUv; varying float vS;
void main(){
  vUv=uv; vec3 p=position; float k=uv.x;
  float wave=sin(k*7.-uTime*3.2)*7.*k+sin(k*13.-uTime*4.5)*2.*k;
  p.z+=wave; p.y+=sin(k*5.-uTime*2.4)*2.2*k; vS=cos(k*7.-uTime*3.2)*k;
  vec4 w=modelMatrix*vec4(p,1.); w.xyz*=1.; gl_Position=projectionMatrix*viewMatrix*w;
}`

export const flagFrag = /* glsl */`
precision mediump float; uniform sampler2D uMap; varying vec2 vUv; varying float vS;
void main(){ vec3 c=texture2D(uMap,vUv).rgb; c*=1.+vS*.16; gl_FragColor=vec4(c,1.); }`
