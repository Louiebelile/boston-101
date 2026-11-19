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

export const popChunk = /* glsl */`
uniform vec3 uReveal; uniform float uSoft;
float pop(vec2 c, float seed){
  float t=clamp((uReveal.z-distance(c,uReveal.xy)-seed*90.)/uSoft,0.,1.);
  return 1.-pow(1.-t,3.)+sin(t*3.14159)*.11;
}
`

export const buildingVert = /* glsl */`
attribute vec2 aC; attribute vec2 aM;
uniform float uBase;
${popChunk}
varying vec3 vW; varying vec2 vM; varying vec2 vC;
void main(){
  float p=pop(aC,aM.y); vec3 w=position; w.y=uBase+position.y*p-(p<.004?5.:0.);
  vW=w; vM=aM; vC=aC; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
}`

export const buildingFrag = /* glsl */`
precision highp float;
varying vec3 vW; varying vec2 vM; varying vec2 vC;
uniform vec4 uFocus; uniform float uColor; uniform float uBase; uniform float uDetail;
${shadeChunk}
vec3 pick(float s, vec3 a, vec3 b, vec3 c, vec3 d){ return s<.25?a:(s<.5?b:(s<.75?c:d)); }
void main(){
  vec3 n=flatNormal(vW); float type=floor(vM.x+.5); float s=vM.y;
  vec3 wall=vec3(.965,.91,.79);
  if(type<1.5&&type>.5) wall=pick(s,vec3(.96,.89,.74),vec3(.72,.84,.8),vec3(.95,.78,.62),vec3(.98,.94,.83));
  else if(type<2.5&&type>1.5) wall=pick(s,vec3(.93,.79,.56),vec3(.98,.93,.8),vec3(.62,.79,.76),vec3(.91,.67,.52));
  else if(type<3.5&&type>2.5) wall=pick(s,vec3(.92,.67,.2),vec3(.84,.42,.29),vec3(.3,.62,.6),vec3(.97,.87,.62));
  else if(type<4.5&&type>3.5) wall=pick(s,vec3(.78,.42,.31),vec3(.86,.6,.42),vec3(.93,.84,.68),vec3(.55,.66,.65));
  else if(type<5.5&&type>4.5) wall=pick(s,vec3(.73,.26,.18),vec3(.8,.38,.26),vec3(.93,.72,.33),vec3(.65,.32,.26));
  else if(type<6.5&&type>5.5) wall=pick(s,vec3(.6,.76,.74),vec3(.87,.85,.74),vec3(.47,.65,.66),vec3(.8,.82,.74));
  else if(type<7.5&&type>6.5) wall=vec3(.72,.7,.63);
  vec3 roof=mix(wall,vec3(.99,.96,.87),.38+s*.2);
  bool slope=n.y>.3&&n.y<.96; if(slope) roof=pick(fract(s*7.),vec3(.24,.33,.41),vec3(.66,.25,.17),vec3(.38,.47,.42),vec3(.32,.42,.5));
  float isRoof=step(.3,n.y); vec3 color=mix(wall,roof,isRoof);
  float f=smoothstep(uFocus.z,uFocus.z*.62,distance(vC,uFocus.xy))*uFocus.w;
  float amount=clamp(uColor+f*.8-(uFocus.w*.28),0.,1.);
  color=mix(vec3(.985,.95,.86),color,amount);
  if(isRoof<.5&&uDetail>.5){
    float d=distance(vW,uCam); float fade=1.-smoothstep(170.,390.,d);
    if(fade>.01){
      vec2 tangent=normalize(vec2(-n.z,n.x)+1e-4); float u=dot(vW.xz,tangent)/4.2; float h=(vW.y-uBase)/4.4;
      vec2 c=fract(vec2(u,h)); float win=step(.26,c.x)*step(c.x,.74)*step(.3,c.y)*step(c.y,.76)*step(.7,h);
      float lit=hash(floor(vec2(u,h))+s*20.); vec3 glass=lit>.72?vec3(.98,.78,.3):vec3(.17,.3,.4);
      color=mix(color,glass,win*fade*.72*amount);
    }
  }
  gl_FragColor=vec4(paperLight(color,n,vW),1.);
}`

export const shadowVert = /* glsl */`
attribute vec2 aC; attribute vec2 aM;
uniform float uBase; uniform vec2 uSun;
${popChunk}
void main(){
  float p=pop(aC,aM.y); float h=position.y*p; if(p<.004) h=0.;
  vec3 w=vec3(position.x+h*uSun.x,uBase+.9,position.z+h*uSun.y);
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
