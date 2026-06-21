import{r as g,a as et,R as rt}from"./react-vendor-cxkclgJA.js";(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))n(r);new MutationObserver(r=>{for(const i of r)if(i.type==="childList")for(const c of i.addedNodes)c.tagName==="LINK"&&c.rel==="modulepreload"&&n(c)}).observe(document,{childList:!0,subtree:!0});function e(r){const i={};return r.integrity&&(i.integrity=r.integrity),r.referrerPolicy&&(i.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?i.credentials="include":r.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function n(r){if(r.ep)return;r.ep=!0;const i=e(r);fetch(r.href,i)}})();var J={exports:{}},Y={};/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var ot=g,nt=Symbol.for("react.element"),it=Symbol.for("react.fragment"),st=Object.prototype.hasOwnProperty,at=ot.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,ct={key:!0,ref:!0,__self:!0,__source:!0};function Q(p,t,e){var n,r={},i=null,c=null;e!==void 0&&(i=""+e),t.key!==void 0&&(i=""+t.key),t.ref!==void 0&&(c=t.ref);for(n in t)st.call(t,n)&&!ct.hasOwnProperty(n)&&(r[n]=t[n]);if(p&&p.defaultProps)for(n in t=p.defaultProps,t)r[n]===void 0&&(r[n]=t[n]);return{$$typeof:nt,type:p,key:i,ref:c,props:r,_owner:at.current}}Y.Fragment=it;Y.jsx=Q;Y.jsxs=Q;J.exports=Y;var f=J.exports,q={},X=et;q.createRoot=X.createRoot,q.hydrateRoot=X.hydrateRoot;const z=Math.PI/180,lt=180/Math.PI,ft=6371e3;function V(p,t,e,n){const r=e*z,i=p*z,c=(p-e)*z,s=(t-n)*z,a=Math.sin(c/2)**2+Math.cos(r)*Math.cos(i)*Math.sin(s/2)**2,h=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)),_=ft*h,x=Math.sin(s)*Math.cos(i),l=Math.cos(r)*Math.sin(i)-Math.sin(r)*Math.cos(i)*Math.cos(s),u=Math.atan2(x,l)*lt*z;return{x:_*Math.sin(u),y:_*Math.cos(u)}}function H(p){return p.toString(16).toUpperCase().padStart(6,"0")}function K(p){return!p||p<=0?"---":"FL"+Math.round(p).toString().padStart(3,"0")}function $(p){return!p||p<=0?"---":Math.round(p)+"kt"}const ut=`
  attribute vec2 a_position;
  attribute vec3 a_color;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_scale;
  varying vec3 v_color;
  void main() {
    vec2 scaled = a_position * u_scale + u_center;
    vec2 clip = (scaled / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
    v_color = a_color;
  }
`,ht=`
  precision mediump float;
  varying vec3 v_color;
  uniform float u_alpha;
  void main() {
    gl_FragColor = vec4(v_color, u_alpha);
  }
`,dt=`
  attribute vec2 a_position;
  attribute float a_distance;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_scale;
  uniform float u_worldScale;
  varying float v_distance;
  void main() {
    vec2 scaled = a_position * u_scale * u_worldScale + u_center;
    vec2 clip = (scaled / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
    v_distance = a_distance;
  }
`,pt=`
  precision mediump float;
  varying float v_distance;
  uniform vec3 u_color;
  uniform float u_alpha;
  uniform float u_dash;
  uniform float u_gap;
  void main() {
    float pattern = u_dash + u_gap;
    float pos = mod(v_distance, pattern);
    if (pos > u_dash) discard;
    gl_FragColor = vec4(u_color, u_alpha);
  }
`,gt=`
  attribute vec2 a_position;
  attribute vec4 a_color;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_scale;
  varying vec4 v_color;
  void main() {
    vec2 scaled = a_position * u_scale + u_center;
    vec2 clip = (scaled / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
    v_color = a_color;
  }
`,mt=`
  precision mediump float;
  varying vec4 v_color;
  void main() {
    gl_FragColor = v_color;
  }
`,_t=`
  attribute vec2 a_position;
  uniform vec2 u_center;
  uniform float u_radius;
  varying vec2 v_texCoord;
  void main() {
    vec2 p = a_position * u_radius + u_center;
    gl_Position = vec4(p, 0.0, 1.0);
    v_texCoord = a_position * u_radius;
  }
`,xt=`
  precision mediump float;
  varying vec2 v_texCoord;
  uniform vec2 u_centerPx;
  uniform float u_radiusPx;
  uniform float u_sweepAngle;
  uniform float u_sweepWidth;
  void main() {
    vec2 pc = v_texCoord;
    float dist = length(pc);
    if (dist > u_radiusPx) discard;

    float angle = atan(pc.y, pc.x);
    float angDeg = degrees(angle);
    if (angDeg < 0.0) angDeg += 360.0;

    float sweepEnd = u_sweepAngle;
    float sweepStart = sweepEnd - u_sweepWidth;
    float wrapped = sweepStart < 0.0;

    float inSweep = 0.0;
    if (wrapped) {
      if (angDeg >= sweepStart + 360.0 || angDeg <= sweepEnd) inSweep = 1.0;
    } else {
      if (angDeg >= sweepStart && angDeg <= sweepEnd) inSweep = 1.0;
    }
    if (inSweep < 0.5) discard;

    float distFromEnd = 0.0;
    if (wrapped) {
      float d = sweepEnd - angDeg;
      if (d < 0.0) d += 360.0;
      distFromEnd = d / u_sweepWidth;
    } else {
      distFromEnd = (sweepEnd - angDeg) / u_sweepWidth;
    }
    distFromEnd = clamp(distFromEnd, 0.0, 1.0);

    float intensity = pow(1.0 - distFromEnd, 2.0);
    float radial = 1.0 - (dist / u_radiusPx) * 0.4;

    gl_FragColor = vec4(0.0, 1.0, 0.25, intensity * 0.32 * radial);
  }
`;class vt{constructor(t){this.canvas=t;const e=t.getContext("webgl",{antialias:!0,alpha:!0,premultipliedAlpha:!1,preserveDrawingBuffer:!1});if(!e)throw new Error("WebGL not available");this.gl=e,this.tracks=new Map,this.width=0,this.height=0,this.centerPx={x:0,y:0},this.rangeNm=200,this.centerLat=39.86,this.centerLon=116.47,this.metersPerPx=1,this.sweepAngle=0,this.lastTime=performance.now(),this.sweepRpm=15,this._init(),this.resize()}_init(){const t=this.gl;this.basic=this._makeProgram(ut,ht,["a_position","a_color"]),this.dashed=this._makeProgram(dt,pt,["a_position","a_distance"]),this.trail=this._makeProgram(gt,mt,["a_position","a_color"]),this.sweep=this._makeProgram(_t,xt,["a_position"]),this._buildStaticGeometry(),this.planeBuf=t.createBuffer(),this.planeCount=0,this.trailBuf=t.createBuffer(),this.trailCount=0}_makeProgram(t,e,n){const r=this.gl,i=this._compile(r.VERTEX_SHADER,t),c=this._compile(r.FRAGMENT_SHADER,e),s=r.createProgram();if(r.attachShader(s,i),r.attachShader(s,c),r.linkProgram(s),!r.getProgramParameter(s,r.LINK_STATUS))throw new Error(r.getProgramInfoLog(s));const a={program:s};for(const h of n)a[h]=r.getAttribLocation(s,h);return a}_compile(t,e){const n=this.gl,r=n.createShader(t);if(n.shaderSource(r,e),n.compileShader(r),!n.getShaderParameter(r,n.COMPILE_STATUS))throw new Error(n.getShaderInfoLog(r));return r}_buildStaticGeometry(){const t=this.gl,e=512,n=5,r=[],i=[];for(let l=1;l<=n;l++){const o=l/n,u=2*Math.PI*o;for(let m=0;m<=e;m++){const A=m/e*Math.PI*2;r.push(Math.cos(A)*o,Math.sin(A)*o),i.push(m/e*u)}}this.ringVertexCount=(e+1)*n,this.ringBuf=t.createBuffer();const c=new Float32Array(r.length+i.length);for(let l=0;l<r.length/2;l++)c[l*3]=r[l*2],c[l*3+1]=r[l*2+1],c[l*3+2]=i[l];t.bindBuffer(t.ARRAY_BUFFER,this.ringBuf),t.bufferData(t.ARRAY_BUFFER,c,t.STATIC_DRAW);const s=72,a=[],h=[];for(let l=0;l<s;l++){const o=l/s*Math.PI*2;a.push(0,0,Math.cos(o),Math.sin(o)),h.push(0,1)}this.azVertexCount=s*2,this.azBuf=t.createBuffer();const _=new Float32Array(a.length+h.length);for(let l=0;l<a.length/2;l++)_[l*3]=a[l*2],_[l*3+1]=a[l*2+1],_[l*3+2]=h[l];t.bindBuffer(t.ARRAY_BUFFER,this.azBuf),t.bufferData(t.ARRAY_BUFFER,_,t.STATIC_DRAW);const x=new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);this.sqBuf=t.createBuffer(),t.bindBuffer(t.ARRAY_BUFFER,this.sqBuf),t.bufferData(t.ARRAY_BUFFER,x,t.STATIC_DRAW)}_flColorForFL(t){return!t||t<=0?[.4,.4,.4]:t>=400?[1,.2,.2]:t>=350?[1,.4,.3]:t>=300?[1,.7,.2]:t>=250?[1,1,.2]:t>=200?[.6,1,.3]:t>=150?[.2,1,.8]:t>=100?[.3,.8,1]:[0,1,.25]}setCenter(t,e){this.centerLat=t,this.centerLon=e}setRange(t){this.rangeNm=t,this.resize()}resize(){const t=Math.min(window.devicePixelRatio||1,2),e=this.canvas.clientWidth||window.innerWidth,n=this.canvas.clientHeight||window.innerHeight;this.canvas.width=Math.floor(e*t),this.canvas.height=Math.floor(n*t),this.width=this.canvas.width,this.height=this.canvas.height,this.centerPx.x=this.width/2,this.centerPx.y=this.height/2;const r=Math.min(this.width,this.height);this.radiusPx=r/2,this.metersPerPx=this.rangeNm*1852/this.radiusPx,this.gl.viewport(0,0,this.width,this.height)}updateTracks(t){this.tracks=t}_project(t){return t.hasPosition?V(t.latitude,t.longitude,this.centerLat,this.centerLon):null}_updatePlaneBuffer(){const t=this.gl,e=[],n=[],c=6*this.metersPerPx;for(const a of this.tracks.values()){const h=this._project(a);if(!h||Math.sqrt(h.x*h.x+h.y*h.y)>this.rangeNm*1852)continue;const x=this._flColorForFL(a.flightLevel),l=(a.trackAngle||0)*Math.PI/180,o=Math.cos(l),u=Math.sin(l),m=o*c*1.8,A=u*c*1.8,E=-o*c-u*c*.8,L=-u*c+o*c*.8,P=-o*c+u*c*.8,w=-u*c-o*c*.8;e.push(h.x+m,h.y+A,h.x+E,h.y+L,h.x+P,h.y+w);for(let v=0;v<3;v++)n.push(...x)}this.planeCount=e.length/2,t.bindBuffer(t.ARRAY_BUFFER,this.planeBuf);const s=new Float32Array(e.length+n.length);for(let a=0;a<e.length/2;a++)s[a*5]=e[a*2],s[a*5+1]=e[a*2+1],s[a*5+2]=n[a*3],s[a*5+3]=n[a*3+1],s[a*5+4]=n[a*3+2];t.bufferData(t.ARRAY_BUFFER,s,t.DYNAMIC_DRAW)}_updateTrailBuffer(){const t=this.gl,e=[],n=[],r=60;for(const s of this.tracks.values()){const a=s.trail;if(!a||a.length<2)continue;const h=this._flColorForFL(s.flightLevel),_=Math.max(0,a.length-r);for(let x=_;x<a.length-1;x++){const l=V(a[x].lat,a[x].lon,this.centerLat,this.centerLon),o=V(a[x+1].lat,a[x+1].lon,this.centerLat,this.centerLon),u=Math.sqrt(l.x*l.x+l.y*l.y),m=Math.sqrt(o.x*o.x+o.y*o.y);if(u>this.rangeNm*1852||m>this.rangeNm*1852)continue;const A=a.length-_-1,E=(x-_)/A*.7,L=(x+1-_)/A*.7;e.push(l.x,l.y,o.x,o.y),n.push(h[0],h[1],h[2],E),n.push(h[0],h[1],h[2],L)}}this.trailCount=e.length/2,t.bindBuffer(t.ARRAY_BUFFER,this.trailBuf);const i=new Float32Array(e.length+n.length);let c=0;for(let s=0;s<e.length/2;s++)i[c++]=e[s*2],i[c++]=e[s*2+1],i[c++]=n[s*4],i[c++]=n[s*4+1],i[c++]=n[s*4+2],i[c++]=n[s*4+3];t.bufferData(t.ARRAY_BUFFER,i,t.DYNAMIC_DRAW)}render(){const t=this.gl,e=performance.now(),n=(e-this.lastTime)/1e3;this.lastTime=e,this.sweepAngle=(this.sweepAngle+360*this.sweepRpm/60*n)%360,t.clearColor(0,.015,.005,1),t.clear(t.COLOR_BUFFER_BIT),t.enable(t.BLEND),t.blendFunc(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA),this._updatePlaneBuffer(),this._updateTrailBuffer(),this._drawSweep(),this._drawAzimuth(),this._drawRings(),this._drawTrails(),this._drawPlanes()}_drawSweep(){const t=this.gl,e=this.sweep;t.useProgram(e.program),this.width/this.width,this.height/this.height,t.uniform2f(t.getUniformLocation(e.program,"u_center"),this.centerPx.x/this.width*2-1,-(this.centerPx.y/this.height*2-1)),t.uniform1f(t.getUniformLocation(e.program,"u_radius"),this.radiusPx/this.width*2),t.uniform2f(t.getUniformLocation(e.program,"u_centerPx"),0,0),t.uniform1f(t.getUniformLocation(e.program,"u_radiusPx"),this.radiusPx),t.uniform1f(t.getUniformLocation(e.program,"u_sweepAngle"),this.sweepAngle),t.uniform1f(t.getUniformLocation(e.program,"u_sweepWidth"),30),t.bindBuffer(t.ARRAY_BUFFER,this.sqBuf),t.enableVertexAttribArray(e.a_position),t.vertexAttribPointer(e.a_position,2,t.FLOAT,!1,0,0),t.drawArrays(t.TRIANGLES,0,6)}_drawRings(){const t=this.gl,e=this.dashed;t.useProgram(e.program),t.uniform2f(t.getUniformLocation(e.program,"u_resolution"),this.width,this.height),t.uniform2f(t.getUniformLocation(e.program,"u_center"),this.centerPx.x,this.centerPx.y),t.uniform1f(t.getUniformLocation(e.program,"u_scale"),1),t.uniform1f(t.getUniformLocation(e.program,"u_worldScale"),this.radiusPx),t.uniform3f(t.getUniformLocation(e.program,"u_color"),0,.7,.2),t.uniform1f(t.getUniformLocation(e.program,"u_alpha"),.55),t.uniform1f(t.getUniformLocation(e.program,"u_dash"),.015),t.uniform1f(t.getUniformLocation(e.program,"u_gap"),.01),t.bindBuffer(t.ARRAY_BUFFER,this.ringBuf),t.enableVertexAttribArray(e.a_position),t.vertexAttribPointer(e.a_position,2,t.FLOAT,!1,12,0),t.enableVertexAttribArray(e.a_distance),t.vertexAttribPointer(e.a_distance,1,t.FLOAT,!1,12,8);for(let n=0;n<5;n++)t.drawArrays(t.LINE_STRIP,n*513,513)}_drawAzimuth(){const t=this.gl,e=this.dashed;t.useProgram(e.program),t.uniform2f(t.getUniformLocation(e.program,"u_resolution"),this.width,this.height),t.uniform2f(t.getUniformLocation(e.program,"u_center"),this.centerPx.x,this.centerPx.y),t.uniform1f(t.getUniformLocation(e.program,"u_scale"),1),t.uniform1f(t.getUniformLocation(e.program,"u_worldScale"),this.radiusPx),t.uniform3f(t.getUniformLocation(e.program,"u_color"),0,.5,.15),t.uniform1f(t.getUniformLocation(e.program,"u_alpha"),.4),t.uniform1f(t.getUniformLocation(e.program,"u_dash"),.02),t.uniform1f(t.getUniformLocation(e.program,"u_gap"),.04),t.bindBuffer(t.ARRAY_BUFFER,this.azBuf),t.enableVertexAttribArray(e.a_position),t.vertexAttribPointer(e.a_position,2,t.FLOAT,!1,12,0),t.enableVertexAttribArray(e.a_distance),t.vertexAttribPointer(e.a_distance,1,t.FLOAT,!1,12,8),t.drawArrays(t.LINES,0,this.azVertexCount)}_drawTrails(){if(this.trailCount===0)return;const t=this.gl,e=this.trail;t.useProgram(e.program),t.uniform2f(t.getUniformLocation(e.program,"u_resolution"),this.width,this.height),t.uniform2f(t.getUniformLocation(e.program,"u_center"),this.centerPx.x,this.centerPx.y),t.uniform1f(t.getUniformLocation(e.program,"u_scale"),1/this.metersPerPx),t.bindBuffer(t.ARRAY_BUFFER,this.trailBuf),t.enableVertexAttribArray(e.a_position),t.vertexAttribPointer(e.a_position,2,t.FLOAT,!1,24,0),t.enableVertexAttribArray(e.a_color),t.vertexAttribPointer(e.a_color,4,t.FLOAT,!1,24,8),t.lineWidth(1.5),t.drawArrays(t.LINES,0,this.trailCount)}_drawPlanes(){if(this.planeCount===0)return;const t=this.gl,e=this.basic;t.useProgram(e.program),t.uniform2f(t.getUniformLocation(e.program,"u_resolution"),this.width,this.height),t.uniform2f(t.getUniformLocation(e.program,"u_center"),this.centerPx.x,this.centerPx.y),t.uniform1f(t.getUniformLocation(e.program,"u_scale"),1/this.metersPerPx),t.uniform1f(t.getUniformLocation(e.program,"u_alpha"),1),t.bindBuffer(t.ARRAY_BUFFER,this.planeBuf),t.enableVertexAttribArray(e.a_position),t.vertexAttribPointer(e.a_position,2,t.FLOAT,!1,20,0),t.enableVertexAttribArray(e.a_color),t.vertexAttribPointer(e.a_color,3,t.FLOAT,!1,20,8),t.drawArrays(t.TRIANGLES,0,this.planeCount)}getScreenPos(t){const e=this._project(t);return e?{x:e.x/this.metersPerPx+this.centerPx.x,y:e.y/this.metersPerPx+this.centerPx.y,inRange:Math.sqrt(e.x*e.x+e.y*e.y)<=this.rangeNm*1852}:null}}const wt=1e3/20;function At({tracksRef:p,connected:t,stats:e,tickFrame:n}){const r=g.useRef(null),i=g.useRef(null),c=g.useRef(null),s=g.useRef(null),a=g.useRef(0),h=g.useRef(0),[_,x]=g.useState(200),[l,o]=g.useState(!0),[u,m]=g.useState(null),[A,E]=g.useState(null);g.useCallback(()=>s.current,[]),g.useEffect(()=>{if(!r.current)return;try{const d=new vt(r.current);d.setCenter(39.86,116.47),d.setRange(_),s.current=d}catch(d){console.error("Renderer init failed:",d);return}const v=()=>{if(s.current&&s.current.resize(),i.current){const d=Math.min(window.devicePixelRatio||1,2),R=c.current?.clientWidth||window.innerWidth,F=c.current?.clientHeight||window.innerHeight;i.current.width=Math.floor(R*d),i.current.height=Math.floor(F*d),i.current.style.width=R+"px",i.current.style.height=F+"px"}};v(),window.addEventListener("resize",v);const b=()=>{const d=s.current;if(d){d.updateTracks(p.current),d.render(),n();const R=performance.now();R-h.current>=wt&&(h.current=R,L())}a.current=requestAnimationFrame(b)};return a.current=requestAnimationFrame(b),()=>{cancelAnimationFrame(a.current),window.removeEventListener("resize",v)}},[p,n]),g.useEffect(()=>{s.current&&s.current.setRange(_)},[_]);const L=g.useCallback(()=>{if(!l)return;const v=i.current,b=s.current;if(!v||!b)return;const d=v.getContext("2d"),R=Math.min(window.devicePixelRatio||1,2);d.setTransform(R,0,0,R,0,0),d.clearRect(0,0,v.width,v.height),d.font='11px Consolas, "Courier New", monospace',d.textBaseline="top";const F=[];for(const y of p.current.values()){if(!y.hasPosition)continue;const S=b.getScreenPos(y);!S||!S.inRange||F.push({t:y,sp:S})}const B=[],C=92,M=38,T=14;for(const{t:y,sp:S}of F){const W=S.x,Z=S.y,D=W+T,U=Z-M/2;let G=!1;for(const j of B)if(D<j.x+j.w+2&&D+C+2>j.x&&U<j.y+j.h+2&&U+M+2>j.y){G=!0;break}if(G)continue;B.push({x:D,y:U,w:C,h:M});const k=y.flightLevel||0;let N="rgba(0, 40, 10, 0.75)",I="#00ff41",O="#00ff41";k>=400?(I="#ff4444",O="#ff6666",N="rgba(40, 0, 0, 0.75)"):k>=300?(I="#ffcc33",O="#ffdd66",N="rgba(40, 30, 0, 0.75)"):k>=200?(I="#88ff55",O="#aaff77",N="rgba(10, 40, 10, 0.75)"):k>0&&(I="#44ccff",O="#66ddff",N="rgba(0, 20, 40, 0.75)"),d.fillStyle=N,d.strokeStyle=I,d.lineWidth=1,d.beginPath(),d.rect(D,U,C,M),d.fill(),d.stroke(),d.fillStyle=O;const tt=y.callsign?.trim()||(y.modeSAddress?H(y.modeSAddress):"??????");d.fillText(tt,D+5,U+3),d.fillText(K(y.flightLevel)+" "+$(y.groundSpeed),D+5,U+17)}},[l,p]),P=v=>{const b=c.current.getBoundingClientRect(),d=v.clientX-b.left,R=v.clientY-b.top;E({x:d,y:R});const F=s.current;if(!F)return;let B=null,C=25;for(const M of p.current.values()){if(!M.hasPosition)continue;const T=F.getScreenPos(M);if(!T||!T.inRange)continue;const y=T.x-d,S=T.y-R,W=Math.sqrt(y*y+S*S);W<C&&(C=W,B={t:M,sp:T})}m(B?B.t:null)},w=v=>{v.preventDefault();const b=[40,80,120,200,300,400],d=b.indexOf(_),R=Math.max(0,Math.min(b.length-1,d+(v.deltaY>0?1:-1)));x(b[R])};return f.jsxs("div",{ref:c,style:{position:"absolute",inset:0,cursor:"crosshair",background:"#000"},onMouseMove:P,onWheel:w,children:[f.jsx("canvas",{ref:r,style:{position:"absolute",inset:0,width:"100%",height:"100%"}}),f.jsx("canvas",{ref:i,style:{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}),f.jsxs("div",{style:{position:"absolute",top:12,left:12,padding:"8px 14px",background:"rgba(0, 20, 5, 0.75)",border:"1px solid #00ff41",fontSize:12,lineHeight:1.7,color:"#00ff41",letterSpacing:.5},children:[f.jsx("div",{style:{fontSize:13,fontWeight:"bold",marginBottom:4,letterSpacing:2},children:"◉ SSR RADAR PPI"}),f.jsxs("div",{children:["RANGE: ",f.jsxs("span",{style:{color:"#ffcc33"},children:[_,"NM"]})]}),f.jsxs("div",{children:["TRACKS: ",f.jsx("span",{style:{color:"#66ddff"},children:e.count})]}),f.jsxs("div",{children:["FPS: ",f.jsx("span",{style:{color:e.fps>=18?"#00ff41":"#ff6666"},children:e.fps}),"/20"]}),f.jsxs("div",{children:["LINK: ",t?f.jsx("span",{style:{color:"#00ff41"},children:"● ONLINE"}):f.jsx("span",{style:{color:"#ff6666"},children:"○ OFFLINE"})]})]}),f.jsxs("div",{style:{position:"absolute",top:12,right:12,padding:"8px 14px",background:"rgba(0, 20, 5, 0.75)",border:"1px solid #00ff41",fontSize:11,lineHeight:1.8,color:"#00ff41",letterSpacing:.5},children:[f.jsx("div",{style:{fontWeight:"bold",marginBottom:4},children:"FLIGHT LEVELS"}),f.jsxs("div",{children:[f.jsx("span",{style:{color:"#ff4444"},children:"■"})," FL400+"]}),f.jsxs("div",{children:[f.jsx("span",{style:{color:"#ffcc33"},children:"■"})," FL300-400"]}),f.jsxs("div",{children:[f.jsx("span",{style:{color:"#88ff55"},children:"■"})," FL200-300"]}),f.jsxs("div",{children:[f.jsx("span",{style:{color:"#44ccff"},children:"■"})," FL100-200"]}),f.jsxs("div",{children:[f.jsx("span",{style:{color:"#00ff41"},children:"■"})," BELOW FL100"]})]}),f.jsx("div",{style:{position:"absolute",bottom:12,left:12,padding:"6px 12px",background:"rgba(0, 20, 5, 0.75)",border:"1px solid #00ff41",fontSize:11,color:"#00ff41"},children:"[滚轮] 缩放量程 · [悬停] 查看详情"}),u&&A&&f.jsxs("div",{style:{position:"absolute",left:Math.min(A.x+14,window.innerWidth-220),top:Math.min(A.y+14,window.innerHeight-160),padding:"10px 14px",background:"rgba(0, 20, 5, 0.92)",border:"1px solid #ffcc33",fontSize:12,lineHeight:1.8,color:"#ffcc33",minWidth:200,pointerEvents:"none",boxShadow:"0 0 20px rgba(255, 204, 51, 0.25)"},children:[f.jsx("div",{style:{fontWeight:"bold",fontSize:14,marginBottom:6,color:"#fff"},children:u.callsign?.trim()||(u.modeSAddress?H(u.modeSAddress):"UNKNOWN")}),u.modeSAddress?f.jsxs("div",{children:["MODE-S: 0x",H(u.modeSAddress)]}):null,f.jsxs("div",{children:["LAT: ",u.latitude?.toFixed(4),"°"]}),f.jsxs("div",{children:["LON: ",u.longitude?.toFixed(4),"°"]}),f.jsxs("div",{children:["ALT: ",K(u.flightLevel)]}),f.jsxs("div",{children:["SPD: ",$(u.groundSpeed)]}),f.jsxs("div",{children:["HDG: ",u.trackAngle?Math.round(u.trackAngle)+"°":"---"]}),f.jsxs("div",{children:["TRACK: ",u.trackNumber||"---"]})]})]})}function Rt(p){const t=g.useRef(new Map),[e,n]=g.useState(!1),[r,i]=g.useState({count:0,fps:0}),c=g.useRef(0),s=g.useRef(Date.now()),a=g.useRef(new Set),h=g.useCallback(o=>(a.current.add(o),()=>a.current.delete(o)),[]),_=g.useCallback(()=>{for(const o of a.current)try{o(t.current)}catch{}},[]),x=g.useCallback(o=>{const u=t.current.get(o.key);if(!u)t.current.set(o.key,{...o});else{const m={...u};o.hasPosition&&(m.latitude=o.latitude,m.longitude=o.longitude,m.hasPosition=!0),o.hasAltitude&&(m.flightLevel=o.flightLevel),o.hasModeS&&(m.modeSAddress=o.modeSAddress),o.callsign&&o.callsign.trim()&&(m.callsign=o.callsign.trim()),o.groundSpeed&&(m.groundSpeed=o.groundSpeed),o.trackAngle&&(m.trackAngle=o.trackAngle),o.trail&&o.trail.length>0&&(m.trail=o.trail),m.lastUpdate=Date.now(),t.current.set(o.key,m)}},[]);g.useEffect(()=>{let o,u;const A=()=>{try{o=new WebSocket(p)}catch{E();return}o.onopen=()=>{n(!0)},o.onmessage=L=>{try{const P=JSON.parse(L.data);if(P.type==="snapshot"){t.current=new Map;for(const w of P.tracks)w.hasPosition&&t.current.set(w.key,{...w,lastUpdate:Date.now()});i(w=>({...w,count:t.current.size})),_()}else if(P.type==="update"){for(const w of P.tracks)w.hasPosition&&x(w);i(w=>({...w,count:t.current.size})),_()}else if(P.type==="cleanup"){for(const[w,v]of t.current)Date.now()-(v.lastUpdate||0)>6e4&&t.current.delete(w);i(w=>({...w,count:t.current.size})),_()}}catch(P){console.warn("WS parse error",P)}},o.onclose=()=>{n(!1),E()},o.onerror=()=>{try{o.close()}catch{}}},E=()=>{clearTimeout(u),u=setTimeout(A,2e3)};return A(),()=>{clearTimeout(u);try{o.close()}catch{}}},[p,x,_]),g.useEffect(()=>{const o=setInterval(()=>{const u=Date.now(),m=(u-s.current)/1e3;i(A=>({...A,fps:Math.round(c.current/m)})),c.current=0,s.current=u},1e3);return()=>clearInterval(o)},[]);const l=g.useCallback(()=>{c.current++},[]);return{tracksRef:t,connected:e,stats:r,subscribe:h,tickFrame:l}}const yt=typeof window<"u"&&(window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1")?"ws://localhost:8091":`ws://${typeof window<"u"?window.location.hostname:"localhost"}:8091`;function bt(){const{tracksRef:p,connected:t,stats:e,tickFrame:n}=Rt(yt);return f.jsx("div",{style:{width:"100%",height:"100%",position:"relative"},children:f.jsx(At,{tracksRef:p,connected:t,stats:e,tickFrame:n})})}q.createRoot(document.getElementById("root")).render(f.jsx(rt.StrictMode,{children:f.jsx(bt,{})}));
