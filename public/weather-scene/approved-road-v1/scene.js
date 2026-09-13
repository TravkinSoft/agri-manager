
 (()=>{
 const root=document.getElementById('tf-wheat-light'),view=root.querySelector('.view'),status=root.querySelector('[role="status"]');
 const slider=root.querySelector('#wind-light-speed'),out=root.querySelector('output[for="wind-light-speed"]'),pause=root.querySelector('[data-action="pause"]'),close=root.querySelector('[data-action="close"]');
 const clockInput=root.querySelector('#sun-time-slider'),clockOutput=root.querySelector('output[for="sun-time-slider"]');
 function clockLabel(){const minutes=Math.round(Number(clockInput.value)*60),label=String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');clockOutput.textContent=label;clockInput.setAttribute('aria-valuetext',label);}
 const rainInput=root.querySelector('#rain-light-amount'),rainOutput=root.querySelector('output[for="rain-light-amount"]');
 function rainLabel(){const v=Number(rainInput.value);rainOutput.textContent=v===0?'Нет':v<30?'Слабый':v<70?'Дождь':'Ливень';rainInput.setAttribute('aria-valuetext',rainOutput.textContent);}
 let stopped=false,launched=false,loadTimer=0;let release=()=>{};
 let productState={hour:17.25,wind:0,rain:0,cloud:.35,active:false,paused:true},applyProduct=()=>{};
 const announce=type=>parent.postMessage({type},location.origin);
 window.addEventListener('message',event=>{
   if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='tf-weather-scene')return;
   const p=event.data;
   if(!['hour','wind','rain','cloud'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k]))||typeof p.active!=='boolean'||typeof p.paused!=='boolean')return;
   productState={hour:Math.max(0,Math.min(24,p.hour)),wind:Math.max(0,Math.min(16,p.wind)),rain:Math.max(0,Math.min(1,p.rain)),cloud:Math.max(0,Math.min(1,p.cloud)),active:p.active,paused:p.paused};
   clockInput.value=String(productState.hour);slider.value=String(productState.wind);rainInput.value=String(productState.rain*100);
   if(!launched&&productState.active)launch();else applyProduct();
 });
 window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(loadTimer);lifecycle.abort();release();});
 announce('tf-weather-ready');
 const lifecycle=new AbortController();const detach=new MutationObserver(()=>{if(!root.isConnected){stopped=true;clearTimeout(loadTimer);lifecycle.abort();release();detach.disconnect();}});detach.observe(document.body,{childList:true,subtree:true});
 const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
 function fail(){announce('tf-weather-failed');stopped=true;clearTimeout(loadTimer);release();root.dataset.state='failed';if(view.querySelector('img'))view.querySelector('img').hidden=false;status.hidden=false;status.textContent='3D не запустилось в этом браузере.';root.querySelectorAll('button,input').forEach(el=>el.disabled=true);}
 async function start(T){try{
 let seed=8107;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const mobile=matchMedia('(max-width:600px)').matches;
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,mobile?1.2:1.4));renderer.outputColorSpace=T.SRGBColorSpace;
 renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=false;
 const textureFrom=async(data)=>{const image=new Image();image.src=data;await image.decode();const t=new T.Texture(image);t.colorSpace=T.SRGBColorSpace;t.needsUpdate=true;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return t;};
 const [leafTexture,barkTexture,wheatTexture,backdropTexture]=await Promise.all([textureFrom('./asset-1.webp'),textureFrom('./asset-2.webp'),textureFrom('./asset-3.webp'),textureFrom('./asset-4.webp')]);
 if(stopped||!root.isConnected){[leafTexture,barkTexture,wheatTexture,backdropTexture].forEach(t=>t.dispose());renderer.dispose();return;}
 await yieldUI();
 barkTexture.wrapS=barkTexture.wrapT=T.RepeatWrapping;barkTexture.repeat.set(2,3);
 view.appendChild(renderer.domElement);
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(43,21/9,.07,650);scene.background=null;
 camera.position.set(0,1.65,6);camera.lookAt(0,.9,-35);
 const uniforms={uSun:{value:new T.Vector3(-.65,.26,-.65)},uDirect:{value:1},uSunTint:{value:new T.Color()},uAmbientTint:{value:new T.Color()},uTime:{value:0},uWind:{value:4},uFog:{value:new T.Color('#b7a078')}};
 const sun=new T.Vector3(-.65,.26,-.65).normalize();
 const groundY=(x,z)=>.10*Math.sin(x*.12+z*.035)+.13*Math.sin(z*.10)+.8*Math.exp(-((x-20)*(x-20)+(z+34)*(z+34))/250.);
 const ambient=new T.HemisphereLight('#bacddd','#413b1d',1.15);scene.add(ambient);
 const sunlight=new T.DirectionalLight('#ffce83',3.1);sunlight.position.copy(sun).multiplyScalar(80);sunlight.castShadow=true;sunlight.shadow.mapSize.set(1024,1024);Object.assign(sunlight.shadow.camera,{left:-28,right:28,top:28,bottom:-28,near:1,far:160});sunlight.shadow.normalBias=.035;sunlight.shadow.bias=-.00015;sunlight.target.position.set(8,0,-17);scene.add(sunlight,sunlight.target);
 // One sun, shared by the visible disk, foliage, wheat and directional light.
 const solar={uTwilight:{value:0},uMoonUV:{value:new T.Vector2(.5,.84)},uMoonVisible:{value:0},uSunUV:{value:new T.Vector2(.2,.7)},uDay:{value:1},uWarm:{value:1},uSunVisible:{value:1}};
 const skyMaterial=new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{...solar,plate:{value:backdropTexture},uCloudShift:{value:0}},vertexShader:`varying vec2 screenUV;void main(){screenUV=uv;gl_Position=vec4(position.xy,1.,1.);}`,fragmentShader:`precision highp float;varying vec2 screenUV;uniform sampler2D plate;uniform vec2 uSunUV,uMoonUV;uniform float uMoonVisible,uTwilight;uniform float uDay,uWarm,uSunVisible,uRain,uCloudShift;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
 float fbm(vec2 p){float v=0.,a=.53;for(int i=0;i<5;i++){v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(7.1,3.4);a*=.47;}return v;}
 float density(vec2 p){float broad=fbm(p);float detail=fbm(p*2.7+21.);return clamp((broad+detail*.16-(.46-uRain*.16))*2.6,0.,1.);}
 void main(){vec3 plateColor=texture2D(plate,screenUV).rgb;float skyMask=smoothstep(.570,.603,screenUV.y);float altitude=clamp((screenUV.y-.58)/.42,0.,1.);
 vec3 clear=mix(vec3(.39,.53,.64),vec3(.035,.21,.43),pow(altitude,.55));clear=mix(clear,vec3(.42,.28,.16),uWarm*.44*(1.-altitude));
 vec2 p=vec2(screenUV.x*7.4,altitude*4.2)+vec2(-uCloudShift,0.);float cloud=density(p),upper=density(p+vec2(-.055,.11));float rim=clamp(cloud-upper,0.,1.);
 float detailLight=fbm(p*5.3+43.);float thickness=cloud*.75+upper*.60;vec3 cloudLight=mix(vec3(.92,.91,.88),vec3(.57,.61,.65),uRain);vec3 cloudDark=mix(vec3(.25,.32,.40),vec3(.065,.085,.12),uRain);vec3 cloudColor=mix(cloudLight,cloudDark,clamp(thickness*.85,0.,1.));cloudColor*=.78+detailLight*.42;cloudColor+=vec3(.40,.30,.14)*rim*uWarm;
 clear=mix(clear,vec3(.20,.26,.33),uRain*.6);float opacity=1.-exp(-cloud*(3.+uRain*2.));vec3 daytime=mix(clear,cloudColor,opacity);float photoX=1.-abs(mod(screenUV.x-uCloudShift/7.4,2.)-1.);vec3 photoSky=texture2D(plate,vec2(photoX,screenUV.y)).rgb;photoSky*=mix(vec3(1.03,1.02,1.),vec3(1.12,.74,.48),uWarm*.72);daytime=mix(photoSky,daytime,uRain*.85);vec2 delta=(screenUV-uSunUV)*vec2(2.333333,1.);float d=length(delta);float transmission=exp(-cloud*(5.+uRain*7.));float disk=1.-smoothstep(.009,.013,d);vec3 sunColor=mix(vec3(1.,.94,.80),vec3(1.,.54,.16),uWarm);
 daytime+=sunColor*(disk*3.4+exp(-d*23.)*.19+exp(-d*90.)*.75)*transmission*uSunVisible*smoothstep(.575,.595,screenUV.y);daytime+=sunColor*rim*exp(-d*3.)*.25*uSunVisible;
 // Night has its own sky, cloud illumination and moon instead of dimmed daylight.
 float photoLuma=dot(photoSky,vec3(.2126,.7152,.0722));float photoCloud=smoothstep(.20,.61,photoLuma);float nightCloud=mix(photoCloud,opacity,uRain*.85);
 vec3 nightClear=mix(vec3(.10,.16,.26),vec3(.023,.045,.105),pow(altitude,.6));vec3 nightCloudColor=mix(vec3(.18,.24,.33),vec3(.12,.17,.25),uRain)*(1.-cloud*.35);
 vec3 night=mix(nightClear,nightCloudColor,nightCloud);
 vec2 starGrid=screenUV*vec2(260.,112.);vec2 starCell=floor(starGrid);float starSeed=hash(starCell+88.);vec2 starLocal=fract(starGrid)-vec2(.2+.6*hash(starCell+9.),.2+.6*hash(starCell+17.));float starShape=exp(-dot(starLocal,starLocal)*180.);float stars=step(.977,starSeed)*starShape*(.4+.6*hash(starCell+31.));night+=vec3(.68,.79,1.)*stars*pow(1.-nightCloud,3.)*(1.-uRain*.95);
 vec2 moonDelta=(screenUV-uMoonUV)*vec2(2.333333,1.);float moonRadius=.022;float md=length(moonDelta);float moonDisk=1.-smoothstep(moonRadius-.001,moonRadius+.001,md);vec2 moonLocal=moonDelta/moonRadius;float maria=fbm(moonLocal*4.1+51.);float crater=fbm(moonLocal*14.+11.);float moonSurface=.57+.30*maria+.14*crater;float moonShade=sqrt(max(0.,1.-dot(moonLocal,moonLocal)))*.35+.65;
 float moonThrough=exp(-nightCloud*(2.8+uRain*3.8));night+=vec3(.70,.81,1.)*(moonDisk*moonSurface*moonShade*1.75+exp(-md*55.)*.095)*moonThrough*uMoonVisible;
 vec3 skyColor=mix(night,daytime,uDay);
 // A low atmospheric glow follows the sun, including the first minutes below the horizon.
 float horizonBand=exp(-pow((screenUV.y-.593)/.095,2.));float sunward=exp(-pow((screenUV.x-clamp(uSunUV.x,.06,.94))/.36,2.));float twilightGlow=uTwilight*(.27+.73*sunward)*(1.-uRain*.76);
 vec3 ember=vec3(.68,.13,.045);vec3 amber=vec3(.93,.34,.095);vec3 duskColor=mix(ember,amber,sunward*.7);
 skyColor=mix(skyColor,duskColor,horizonBand*twilightGlow*.72);float cloudUnderlight=nightCloud*exp(-pow((screenUV.y-.66)/.18,2.))*twilightGlow;skyColor+=vec3(.16,.040,.016)*cloudUnderlight;
 vec3 ground=plateColor*mix(vec3(1.03,1.02,1.),vec3(1.12,.74,.48),uWarm*.72);ground=mix(ground,vec3(dot(ground,vec3(.2126,.7152,.0722)))*vec3(.74,.82,.89),uRain*.55);vec3 moonGround=vec3(dot(plateColor,vec3(.2126,.7152,.0722)))*vec3(.52,.69,.95);ground=mix(moonGround,ground,uDay);ground+=plateColor*vec3(.28,.062,.018)*uTwilight*sunward*(1.-uRain*.8);vec3 c=mix(ground,skyColor,skyMask);gl_FragColor=vec4(pow(max(c,vec3(0.)),vec3(.4545)),1.);}`});
 const skyScreen=new T.Mesh(new T.PlaneGeometry(2,2),skyMaterial);skyScreen.frustumCulled=false;skyScreen.renderOrder=-1000;scene.add(skyScreen);
 const rainUniforms={uRain:{value:0},uRainTime:{value:0},uRainWind:{value:4},uRainDay:solar.uDay};
 skyMaterial.uniforms.uRain={value:0};uniforms.uWet=rainUniforms.uRain;
 // Spatial drops: depth testing lets foliage and wheat hide rain behind them.
 const dropBase=new T.PlaneGeometry(1,1),dropGeo=new T.InstancedBufferGeometry();dropGeo.index=dropBase.index;dropGeo.attributes.position=dropBase.attributes.position;dropGeo.attributes.uv=dropBase.attributes.uv;
 let dropSeed=722;const dropRand=()=>{dropSeed=(Math.imul(dropSeed,1664525)+1013904223)>>>0;return dropSeed/4294967296;};const dropCount=mobile?12000:24000,dropSeeds=[];for(let i=0;i<dropCount;i++)dropSeeds.push(dropRand(),dropRand(),dropRand(),dropRand());dropGeo.setAttribute('dropSeed',new T.InstancedBufferAttribute(new Float32Array(dropSeeds),4));dropGeo.instanceCount=dropCount;
 const rainMaterial=new T.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,uniforms:rainUniforms,vertexShader:`attribute vec4 dropSeed;varying vec2 dropUV;varying float visibility,dist;uniform float uRainTime,uRainWind,uRain;
 void main(){dropUV=uv;float fall=10.+dropSeed.w*6.;float z=3.-dropSeed.z*77.;float depth=6.-z;float span=depth*1.95;float ceiling=min(39.,depth*.60+4.);float travel=uRainTime*fall;float y=mod(dropSeed.y*ceiling-travel,ceiling)+.75;float x=mod(dropSeed.x*span+uRainTime*uRainWind*.38,span)-span*.5;vec3 center=vec3(x,y,z);float streakTime=min(.055+dropSeed.w*.035,depth*.021/fall);vec3 tail=vec3(-uRainWind*.38,fall,0.)*streakTime;vec3 v=center+tail*(uv.y-.5);v.x+=(uv.x-.5)*max(.012+dropSeed.w*.018,depth*.0013);vec4 mv=modelViewMatrix*vec4(v,1.);dist=-mv.z;visibility=smoothstep(dropSeed.w*.985,dropSeed.w*.985+.015,pow(uRain,1.45))*smoothstep(.75,1.35,y)*(1.-smoothstep(ceiling-.7,ceiling+.75,y))*smoothstep(.8,2.,dist);gl_Position=projectionMatrix*mv;}`,
 fragmentShader:`precision highp float;varying vec2 dropUV;varying float visibility,dist;uniform float uRainDay;void main(){float edge=1.-smoothstep(.08,.5,abs(dropUV.x-.5));float tip=sin(dropUV.y*3.14159);float depthFade=mix(1.,.52,smoothstep(8.,80.,dist));float alpha=edge*tip*visibility*depthFade*(.27+.19*uRainDay);if(alpha<.006)discard;vec3 color=mix(vec3(.48,.61,.79),vec3(.76,.81,.85),uRainDay);gl_FragColor=vec4(color,alpha);}`});
 const rainScreen=new T.Mesh(dropGeo,rainMaterial);rainScreen.frustumCulled=false;rainScreen.visible=false;scene.add(rainScreen);
 const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
 function applySolar(h){h=((h%24)+24)%24;const overcast=Math.max(rain,cloud);skyMaterial.uniforms.uRain.value=overcast;const phase=(h-6)/12*Math.PI,elevation=Math.sin(phase),day=smooth(-.15,.42,elevation),direct=smooth(-.01,.20,elevation),warm=1.-smooth(.10,.65,elevation);
 const sx=.10+.80*((h-6)/12),sy=.582+.31*elevation;solar.uSunUV.value.set(sx,sy);const twilight=(1.-smooth(.08,.52,Math.abs(elevation)))*smooth(-.23,-.05,elevation);solar.uTwilight.value=twilight;root.dataset.twilight=twilight.toFixed(4);solar.uDay.value=day;solar.uWarm.value=warm;solar.uSunVisible.value=smooth(-.06,.04,elevation)*(1.-overcast*.94);
 const nightHour=h<6?h+24:h,moonPhase=(nightHour-18)/12*Math.PI,moonElevation=Math.sin(moonPhase),night=1.-day;solar.uMoonUV.value.set(.12+.76*((nightHour-18)/12),.60+.27*Math.max(0.,moonElevation));solar.uMoonVisible.value=smooth(-.12,.08,moonElevation);root.dataset.moon=solar.uMoonVisible.value.toFixed(3);
 const moonBlend=1.-smooth(-.16,.04,elevation);const moonDirection=new T.Vector3(-Math.cos(moonPhase),Math.max(.25,moonElevation)*.9,-.65).normalize();uniforms.uSun.value.set(-Math.cos(phase),elevation*.9,-.65).normalize().lerp(moonDirection,moonBlend).normalize();uniforms.uDirect.value=(direct*(1.-moonBlend)+.65*moonBlend)*(1.-overcast*(.65-.25*moonBlend));uniforms.uSunTint.value.setRGB(1.08+twilight*.12,.96-warm*.35-twilight*.10,.82-warm*.53-twilight*.06);uniforms.uSunTint.value.lerp(new T.Color().setRGB(.55,.72,1.03),moonBlend);uniforms.uAmbientTint.value.setRGB(.82+day*.34,.98+day*.18,1.24-day*.06);uniforms.uFog.value.setRGB(.075+day*.233+twilight*.045,.105+day*.207-twilight*.02,.17+day*.036-twilight*.055);uniforms.uAmbientTint.value.multiply(new T.Color().setRGB(1.-twilight*.08,1.-twilight*.035,1.+twilight*.08));root.dataset.shadowLength=(5.5/Math.max(uniforms.uSun.value.y,.065)).toFixed(2);root.dataset.lightX=uniforms.uSun.value.x.toFixed(4);
 sunlight.position.copy(uniforms.uSun.value).multiplyScalar(80).add(sunlight.target.position);sunlight.color.copy(uniforms.uSunTint.value);sunlight.intensity=3.1*direct*(1.-moonBlend)+1.15*moonBlend;ambient.intensity=.98+day*.30;ambient.color.setRGB(.55+day*.12,.66+day*.10,.90-day*.04);
 uniforms.uAmbientTint.value.multiplyScalar(1.-overcast*(.18-.08*moonBlend));sunlight.intensity*=1.-overcast*(.80-.35*moonBlend);ambient.intensity*=1.-overcast*.12;
 root.dataset.rain=rain.toFixed(3);root.dataset.hour=h.toFixed(3);root.dataset.sunX=sx.toFixed(4);root.dataset.sunY=sy.toFixed(4);root.dataset.day=day.toFixed(4);
 }

 // Two worn wheel tracks, following the existing ground into the distance.
 const roadCenter=z=>-1.45+1.9*Math.sin((-z+4)*.024)+.025*(-z);
 const roadPositions=[],roadUV=[],roadIndices=[],roadSegments=320,roadAcross=16;
 for(let j=0;j<=roadSegments;j++){const z=5-j/roadSegments*115;for(let k=0;k<=roadAcross;k++){const lateral=(k/roadAcross-.5)*3.4,x=roadCenter(z)+lateral;const rut=Math.exp(-Math.pow((Math.abs(lateral)-.73)/.28,2.))*.07;roadPositions.push(x,groundY(x,z)+.025-rut,z);roadUV.push(lateral,z);if(j<roadSegments&&k<roadAcross){const a=j*(roadAcross+1)+k,b=a+roadAcross+1;roadIndices.push(a,b,a+1,b,b+1,a+1);}}}
 const roadGeometry=new T.BufferGeometry();roadGeometry.setAttribute('position',new T.Float32BufferAttribute(roadPositions,3));roadGeometry.setAttribute('uv',new T.Float32BufferAttribute(roadUV,2));roadGeometry.setIndex(roadIndices);roadGeometry.computeVertexNormals();
 const roadMaterial=new T.ShaderMaterial({side:T.DoubleSide,uniforms:{...uniforms,...solar,...rainUniforms,plate:{value:backdropTexture},uRoadCloud:skyMaterial.uniforms.uCloudShift},vertexShader:`varying vec2 roadUV;varying vec3 roadWorld,roadNormal;varying vec4 roadClip;void main(){roadUV=uv;roadWorld=position;roadNormal=normal;roadClip=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=roadClip;}`,fragmentShader:`precision highp float;varying vec2 roadUV;varying vec3 roadWorld,roadNormal;varying vec4 roadClip;uniform sampler2D plate;uniform vec3 uSun,uSunTint,uAmbientTint,uFog;uniform vec2 uSunUV,uMoonUV;uniform float uDirect,uWet,uDay,uWarm,uTwilight,uRainTime,uRain,uRoadCloud;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
 void main(){float lateral=roadUV.x,z=roadUV.y;float grain=noise(roadUV*vec2(31.,16.));float coarse=noise(roadUV*vec2(4.,1.2));float trackDistance=abs(abs(lateral)-(.73+.040*sin(z*.71)+.024*sin(z*2.3)));float track=1.-smoothstep(.23,.49+coarse*.06,trackDistance);float edge=noise(roadUV*vec2(8.,3.));float verge=smoothstep(1.32,1.69,abs(lateral));if(abs(lateral)>1.58+edge*.1)discard;
 vec3 soil=mix(vec3(.22,.155,.085),vec3(.35,.275,.17),grain)*(.83+coarse*.27);soil*=1.-uWet*.46;float tread=pow(.5+.5*sin(z*23.+lateral*18.),10.)*.13*track;soil*=1.-tread;vec3 grass=mix(vec3(.064,.105,.025),vec3(.14,.185,.052),grain);vec3 base=mix(grass,soil,track*(1.-verge));float light=max(dot(normalize(roadNormal),normalize(uSun)),0.);vec3 c=base*(uAmbientTint*.64+uSunTint*light*uDirect*.63);
 float basin=noise(vec2(sign(lateral)*8.2+z*.24,z*.61));float waterEdge=noise(roadUV*vec2(15.,3.7));float pool=1.-smoothstep(.08+uWet*.17,.17+uWet*.19,trackDistance+(waterEdge-.5)*.13);pool*=smoothstep(.60-uWet*.18,.78-uWet*.14,basin)*smoothstep(.12,.65,uWet);pool*=1.-verge;
 vec2 waterUV=roadClip.xy/roadClip.w*.5+.5;float ripple=(sin(lateral*90.+z*39.-uRainTime*18.)+sin(z*71.+lateral*35.+uRainTime*13.))*.0012*uRain;float photoX=1.-abs(mod(waterUV.x-uRoadCloud/7.4,2.)-1.);vec2 reflected=vec2(photoX+ripple,clamp(.60+(1.-waterUV.y)*.36+ripple,.60,.97));vec3 sky=texture2D(plate,reflected).rgb;sky*=mix(vec3(1.03,1.02,1.),vec3(1.12,.74,.48),uWarm*.72);sky=mix(vec3(.12,.20,.33),sky,uDay);sky=mix(sky,vec3(dot(sky,vec3(.2126,.7152,.0722)))*vec3(.71,.80,.94),uRain*.72);sky+=vec3(.23,.046,.016)*uTwilight;
 vec3 viewDirection=normalize(cameraPosition-roadWorld);vec3 n=normalize(vec3(ripple*20.,1.,ripple*12.));float fresnel=.16+.48*pow(1.-max(dot(n,viewDirection),0.),3.);vec3 reflectedLight=reflect(-normalize(uSun),n);float glint=pow(max(dot(reflectedLight,viewDirection),0.),70.)*uDirect;vec3 water=mix(soil*.23,sky,fresnel)+uSunTint*glint*.70;c=mix(c,water,pool*.92);
 float distanceFog=1.-exp(-max(-z-20.,0.)*(.004+uWet*.007));c=mix(c,uFog,distanceFog*.42);gl_FragColor=vec4(pow(max(c,vec3(0.)),vec3(.4545)),1.);}`});
 const roadMesh=new T.Mesh(roadGeometry,roadMaterial);roadMesh.frustumCulled=false;scene.add(roadMesh);

 // One plant mesh: segmented stem, leaf blades, paired grains and awns.
 function plantGeometry(detail){const pos=[],norm=[],cols=[],uvs=[];
 function add(g,color){const n=g.index?g.toNonIndexed():g;const p=n.attributes.position,a=n.attributes.normal,u=n.attributes.uv;for(let i=0;i<p.count;i++){pos.push(p.getX(i),p.getY(i),p.getZ(i));norm.push(a.getX(i),a.getY(i),a.getZ(i));cols.push(...color);uvs.push(u?u.getX(i):0,u?u.getY(i):0);}g.dispose();if(n!==g)n.dispose();}
 const stem=new T.CylinderGeometry(.0023,.0038,1.05,4,8);stem.translate(0,.525,0);add(stem,[.22,.27,.057]);
 const axis=new T.CylinderGeometry(.0025,.0035,.25,4);axis.translate(0,1.17,0);add(axis,[.47,.34,.095]);
 for(let j=0;j<9;j++)for(let side=-1;side<=1;side+=2){const y=1.052+j*.024;const taper=Math.sin((j+2)/12*Math.PI)*.85+.15;
 const grain=new T.SphereGeometry(1,detail?6:4,detail?4:2);const gp=grain.attributes.position;
 for(let i=0;i<gp.count;i++){const gy=gp.getY(i);const ridge=1.+.06*Math.cos(Math.atan2(gp.getZ(i),gp.getX(i))*5.);gp.setXYZ(i,gp.getX(i)*.0085*taper*ridge*(1.-gy*.25),gy*.023,gp.getZ(i)*.0085*taper*ridge);}
 grain.rotateZ(-side*.38);grain.rotateY(j%2*.3);grain.translate(side*.010,y,Math.sin(j*1.7)*.002);grain.computeVertexNormals();add(grain,[.70+j*.012,.49+j*.012,.19+j*.006]);
 const length=.055+j*.007;const awn=new T.CylinderGeometry(.00010,.00048,length,3);awn.rotateZ(-side*.23);awn.translate(side*(.015+length*.1),y+length*.44,0);add(awn,[.62,.46,.21]);}
 for(let j=0;j<3;j++){const blade=new T.PlaneGeometry(.023,.30,2,7);const p=blade.attributes.position;for(let i=0;i<p.count;i++){const t=(p.getY(i)+.15)/.3;const ang=j*2.3;const r=.25*t;p.setXYZ(i,Math.cos(ang)*r+p.getX(i)*Math.sin(t*Math.PI),.3+j*.22+.19*Math.sin(t*2.1),Math.sin(ang)*r+p.getX(i)*.3);}blade.computeVertexNormals();add(blade,[.13+j*.025,.205+j*.017,.032]);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('normal',new T.Float32BufferAttribute(norm,3));g.setAttribute('color',new T.Float32BufferAttribute(cols,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));return g;}
 const wheatMaterial=new T.ShaderMaterial({side:T.DoubleSide,uniforms,vertexShader:`attribute vec4 instanceData;attribute vec2 variety;attribute vec3 color;varying vec3 col;varying vec3 wn;varying vec3 wp;uniform float uTime,uWind;
 void main(){float roadX=-1.45+1.9*sin((-instanceData.z+4.)*.024)+.025*(-instanceData.z);if(abs(instanceData.x-roadX)<1.62){gl_Position=vec4(2.,2.,2.,1.);return;}float h=position.y;float theta=variety.x;mat2 rot=mat2(cos(theta),-sin(theta),sin(theta),cos(theta));vec3 p=position;p.x*=.78+variety.y*.44;p.xz=rot*p.xz;p*=instanceData.w;
 // Rest posture varies by plant; the approved time-dependent wind is unchanged.
 float rest=.07+.20*variety.y;p.x+=rest*h*h*instanceData.w;p.z+=sin(variety.x*3.)*.075*h*h*instanceData.w;
 float w=uWind/16.;float phase=instanceData.x*.45+instanceData.z*.34;
 float gust=.55+.28*sin(phase-uTime*1.4)+.17*sin(phase*1.71-uTime*2.);float flutter=sin(uTime*3.+variety.y*12.)*.045;
 float angle=w*(.24+gust*.38+flutter);float bend=angle*h;
 // Circular arc: root stays anchored and arc length stays constant.
 float arc=max(abs(angle),.0001);float centerX=(1.-cos(angle*h))/arc;float centerY=sin(arc*h)/arc;
 p.x+=centerX*instanceData.w;p.y+=(centerY-h)*instanceData.w;p.z+=w*.045*sin(phase-uTime*.85)*h*h;
 vec3 n=normal;n.xz=rot*n.xz;n.xy=mat2(cos(bend),sin(bend),-sin(bend),cos(bend))*n.xy;
 wp=p+instanceData.xyz;wn=n;col=color*(.83+variety.y*.27);gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);}`,
 fragmentShader:`precision highp float;uniform vec3 uSun,uSunTint,uAmbientTint;uniform float uDirect,uWet;varying vec3 col,wn,wp;uniform vec3 uFog;
float treeOcclusion(vec3 p){vec3 l=normalize(uSun);float height=6.5-p.y;if(height<=0.)return 0.;float travel=height/max(l.y,.065);vec2 hit=(p+l*travel).xz-vec2(20.,-34.);float softness=1.+travel*.012;float crown=exp(-dot(hit/vec2(3.2*softness,2.8*softness),hit/vec2(3.2*softness,2.8*softness))*1.6);vec2 lobe=hit-vec2(2.0,.5);crown=max(crown,exp(-dot(lobe/(2.0*softness),lobe/(2.0*softness))*1.7)*.75);lobe=hit+vec2(1.8,.9);crown=max(crown,exp(-dot(lobe/(2.1*softness),lobe/(2.1*softness))*1.5)*.85);return crown*(1.-smoothstep(85.,140.,travel));}

 void main(){vec3 n=normalize(wn);if(!gl_FrontFacing)n=-n;vec3 sun=normalize(uSun);float diffuse=max(dot(n,sun),0.);float back=max(dot(-n,sun),0.);float ao=smoothstep(.05,1.1,wp.y)*.62+.38;float shadow=1.-treeOcclusion(wp)*.78;vec3 c=col*(vec3(.35,.40,.26)*uAmbientTint+uSunTint*(diffuse*.94+back*.35)*uDirect*shadow)*ao;
 float fog=1.-exp(-pow(length(cameraPosition-wp)*(.0065+uWet*.005),1.5));c=mix(c,uFog,fog*.55);gl_FragColor=vec4(pow(c,vec3(.78)),1.);}`});
 let plants=0;
 function field(count,zMin,zMax,detail){const base=plantGeometry(detail),geo=new T.InstancedBufferGeometry();geo.index=base.index;for(const [k,a] of Object.entries(base.attributes))geo.setAttribute(k,a);const offsets=[],variety=[];
 for(let i=0;i<count;i++){const z=zMin+rand()*(zMax-zMin),span=Math.min(90,(6-z)*1.0+3),x=(rand()-.5)*2*span;offsets.push(x,groundY(x,z),z,.80+rand()*.35);variety.push(rand()*Math.PI*2,rand());}
 geo.setAttribute('instanceData',new T.InstancedBufferAttribute(new Float32Array(offsets),4));geo.setAttribute('variety',new T.InstancedBufferAttribute(new Float32Array(variety),2));geo.instanceCount=count;const mesh=new T.Mesh(geo,wheatMaterial);mesh.frustumCulled=false;scene.add(mesh);plants+=count;}
 field(mobile?280:450,-2,4.1,true);
 await yieldUI();
 // Small textured plant meshes use exactly the accepted stem-bending shader.
 const clumpVertex=wheatMaterial.vertexShader.replace('varying vec3 col;','varying vec2 plantUV;varying vec3 col;').replace('void main(){','void main(){plantUV=uv;');
 const clumpMaterial=new T.ShaderMaterial({side:T.DoubleSide,uniforms:{...uniforms,plantMap:{value:wheatTexture}},vertexShader:clumpVertex,fragmentShader:`precision highp float;uniform vec3 uSun,uSunTint,uAmbientTint;uniform float uDirect,uWet;uniform vec3 uFog;uniform sampler2D plantMap;varying vec2 plantUV;varying vec3 wp;varying vec3 col;varying vec3 wn;
float treeOcclusion(vec3 p){vec3 l=normalize(uSun);float height=6.5-p.y;if(height<=0.)return 0.;float travel=height/max(l.y,.065);vec2 hit=(p+l*travel).xz-vec2(20.,-34.);float softness=1.+travel*.012;float crown=exp(-dot(hit/vec2(3.2*softness,2.8*softness),hit/vec2(3.2*softness,2.8*softness))*1.6);vec2 lobe=hit-vec2(2.0,.5);crown=max(crown,exp(-dot(lobe/(2.0*softness),lobe/(2.0*softness))*1.7)*.75);lobe=hit+vec2(1.8,.9);crown=max(crown,exp(-dot(lobe/(2.1*softness),lobe/(2.1*softness))*1.5)*.85);return crown*(1.-smoothstep(85.,140.,travel));}

 void main(){vec4 tex=texture2D(plantMap,plantUV);if(tex.a<.22)discard;
 float height=smoothstep(.12,.94,plantUV.y);float variation=clamp(col.r,.75,1.1);float maturity=smoothstep(.82,1.03,col.r);
 vec3 n=normalize(wn);if(!gl_FrontFacing)n=-n;vec3 sun=normalize(uSun);float front=max(dot(n,sun),0.);float transmission=max(dot(-n,sun),0.);
 vec3 ripe=mix(vec3(.43,.50,.18),vec3(.95,.69,.31),maturity);float patches=.76+.24*(.5+.5*sin(wp.x*.22+wp.z*.34))*(.65+.35*sin(wp.x*.51-wp.z*.16));
 vec3 lighting=vec3(.43,.48,.37)*uAmbientTint+uSunTint*front*.78*uDirect+uSunTint*transmission*.45*uDirect;
 vec3 c=tex.rgb*mix(vec3(.13,.25,.055),ripe,height)*variation*lighting*patches;
 float grain=smoothstep(.55,.77,plantUV.y);float glow=pow(max(dot(normalize(cameraPosition-wp),-sun),0.),4.);c+=tex.rgb*uSunTint*.32*glow*grain*uDirect;
 c*=1.-treeOcclusion(wp)*.36*uDirect;
 float distanceHaze=(1.-exp(-max(-wp.z-20.,0.)*(.006+uWet*.012)))*(.38+uWet*.20);c=mix(c,uFog,distanceHaze);
 gl_FragColor=vec4(pow(max(c,vec3(0.)),vec3(.4545)),1.);}`});
 function clumpField(count,zMin,zMax){const g=new T.PlaneGeometry(.49,1.32,2,14);g.translate(0,.66,0);const colors=[];for(let i=0;i<g.attributes.position.count;i++){const v=g.attributes.uv.getY(i);g.attributes.position.setY(i,v<.55?v/.55*1.02:1.02+(v-.55)/.45*.30);colors.push(1,1,1);}g.computeVertexNormals();g.setAttribute('color',new T.Float32BufferAttribute(colors,3));const geo=new T.InstancedBufferGeometry();geo.index=g.index;for(const [k,a]of Object.entries(g.attributes))geo.setAttribute(k,a);const offsets=[],vars=[];
 for(let i=0;i<count;i++){const z=zMin+rand()*(zMax-zMin),span=(6-z)*.93+2,x=(rand()-.5)*span*2;const growth=.5+.5*Math.sin(x*.31+z*.19);offsets.push(x,groundY(x,z),z,.69+rand()*.36+growth*.11);vars.push((rand()-.5)*2.4,rand());}
 geo.setAttribute('instanceData',new T.InstancedBufferAttribute(new Float32Array(offsets),4));geo.setAttribute('variety',new T.InstancedBufferAttribute(new Float32Array(vars),2));geo.instanceCount=count;const mesh=new T.Mesh(geo,clumpMaterial);mesh.frustumCulled=false;scene.add(mesh);plants+=count*5;}
 clumpField(mobile?1800:2700,-22,4.0);clumpField(mobile?2400:3400,-105,-22);
 await yieldUI();
 // Low-cost foliage fills the field between stalks at the actual viewing distance.
 {const base=new T.PlaneGeometry(.021,.92,1,6);base.translate(0,.46,0);const p=base.attributes.position,colors=[];for(let i=0;i<p.count;i++){const y=p.getY(i);p.setX(i,p.getX(i)*Math.sin(y/.92*Math.PI)+.12*y*y);p.setZ(i,.08*y*y);colors.push(.21+y*.08,.27+y*.075,.047+y*.025);}base.computeVertexNormals();base.setAttribute('color',new T.Float32BufferAttribute(colors,3));const geo=new T.InstancedBufferGeometry();geo.index=base.index;for(const [k,a]of Object.entries(base.attributes))geo.setAttribute(k,a);const offsets=[],vars=[],count=mobile?5200:8500;for(let i=0;i<count;i++){const z=-55+rand()*59,span=(6-z)*.93+2,x=(rand()-.5)*span*2;offsets.push(x,groundY(x,z),z,.7+rand()*.5);vars.push(rand()*6.28,rand());}geo.setAttribute('instanceData',new T.InstancedBufferAttribute(new Float32Array(offsets),4));geo.setAttribute('variety',new T.InstancedBufferAttribute(new Float32Array(vars),2));geo.instanceCount=count;const grass=new T.Mesh(geo,wheatMaterial);grass.frustumCulled=false;scene.add(grass);}
 await yieldUI();
 // Branch hierarchy: leaves inherit their parent branch movement.
 const roadsideBase=new T.PlaneGeometry(.028,.22,1,4);roadsideBase.translate(0,.11,0);const roadsidePoints=roadsideBase.attributes.position;for(let i=0;i<roadsidePoints.count;i++){const t=roadsidePoints.getY(i)/.22;roadsidePoints.setX(i,roadsidePoints.getX(i)*(1.-t)*.9+.024*t*t);roadsidePoints.setZ(i,.035*t*t);}roadsideBase.computeVertexNormals();const roadsideColors=[];for(let i=0;i<roadsideBase.attributes.position.count;i++)roadsideColors.push(.22,.32,.06);roadsideBase.setAttribute('color',new T.Float32BufferAttribute(roadsideColors,3));const roadsideGeo=new T.InstancedBufferGeometry();roadsideGeo.index=roadsideBase.index;Object.entries(roadsideBase.attributes).forEach(([k,v])=>roadsideGeo.setAttribute(k,v));
 const roadsidePositions=[],roadsideVariety=[],roadsideCount=mobile?2200:3800;let vergeSeed=714;const vergeRand=()=>{vergeSeed=(Math.imul(vergeSeed,1664525)+1013904223)>>>0;return vergeSeed/4294967296;};for(let i=0;i<roadsideCount;i++){const z=4-vergeRand()*78,central=vergeRand()<.55,lateral=central?(vergeRand()-.5)*.69:(vergeRand()<.5?-1:1)*(1.25+vergeRand()*.47),x=roadCenter(z)+lateral;roadsidePositions.push(x,groundY(x,z)+.035,z,.55+vergeRand()*.60);roadsideVariety.push(vergeRand()*6.28,vergeRand());}roadsideGeo.setAttribute('instanceData',new T.InstancedBufferAttribute(new Float32Array(roadsidePositions),4));roadsideGeo.setAttribute('variety',new T.InstancedBufferAttribute(new Float32Array(roadsideVariety),2));roadsideGeo.instanceCount=roadsideCount;
 const roadsideMaterial=wheatMaterial.clone();roadsideMaterial.uniforms=uniforms;roadsideMaterial.fragmentShader=roadsideMaterial.fragmentShader.replace("pow(c,vec3(.78))","pow(c,vec3(.4545))");roadsideMaterial.vertexShader=roadsideMaterial.vertexShader.replace(/if\(abs\(instanceData.x-roadX\)<1.62\)\{gl_Position=vec4\(2.,2.,2.,1.\);return;\}/,'');const roadsideMesh=new T.Mesh(roadsideGeo,roadsideMaterial);roadsideMesh.frustumCulled=false;scene.add(roadsideMesh);

 const tree=new T.Group();tree.position.set(20,groundY(20,-34),-34);tree.scale.setScalar(.82);scene.add(tree);
 const bark=new T.MeshStandardMaterial({map:barkTexture,color:'#b2a595',roughness:1}),branches=[],leafTransforms=[];
 function branch(parent,length,radius,depth){const pivot=new T.Group();parent.add(pivot);const woodGeo=new T.CylinderGeometry(radius*.54,radius,length,7,7);const bp=woodGeo.attributes.position;for(let i=0;i<bp.count;i++){const t=(bp.getY(i)+length/2)/length;const flare=1.+Math.pow(1.-t,5)*.25;bp.setX(i,bp.getX(i)*flare+Math.sin(t*Math.PI)*length*.035);bp.setZ(i,bp.getZ(i)*flare+Math.sin(t*Math.PI)*length*.018);}woodGeo.computeVertexNormals();const wood=new T.Mesh(woodGeo,bark);wood.position.y=length/2;wood.castShadow=true;wood.receiveShadow=true;pivot.add(wood);const tip=new T.Group();tip.position.y=length; pivot.add(tip);
 if(depth<4){branches.push({pivot,z:pivot.rotation.z,x:pivot.rotation.x,phase:rand()*6.28,weight:(4-depth)*.010});}
 if(depth===0||depth===2){for(let j=0;j<(depth===0?9:3);j++){const a=rand()*6.283,r=Math.sqrt(rand())*.95;leafTransforms.push({parent:tip,p:new T.Vector3(Math.cos(a)*r,(rand()-.3)*1.5,Math.sin(a)*r),scale:1.1+rand()*.90,rotation:new T.Euler((rand()-.5)*1.9,(rand()-.5)*2.1,rand()*6.28)});}if(depth===0)return pivot;}
 const n=depth===4?5:3;for(let j=0;j<n;j++){const child=branch(tip,length*(depth===4?.72+rand()*.17:.59+rand()*.20),radius*.53,depth-1);child.rotation.order='YXZ';child.rotation.z=depth===4?.52+rand()*.38:.28+rand()*.48;child.rotation.y=j*Math.PI*2/n+rand()*.45;child.rotation.x=(rand()-.5)*.24;const rec=branches.find(b=>b.pivot===child);if(rec){rec.z=child.rotation.z;rec.x=child.rotation.x;}}
 return pivot;}
 branch(tree,3.5,.41,4);
 const leafGeo=new T.PlaneGeometry(1,1,2,3);const lp=leafGeo.attributes.position;for(let i=0;i<lp.count;i++)lp.setZ(i,Math.abs(lp.getX(i))*.16+Math.pow(lp.getY(i),2)*.15);leafGeo.computeVertexNormals();
 const leafMat=new T.ShaderMaterial({side:T.DoubleSide,uniforms:{...uniforms,leafMap:{value:leafTexture}},vertexShader:`varying vec2 leafUV;varying vec3 leafWorld,leafNormal,leafTint;void main(){leafUV=uv;vec4 p=instanceMatrix*vec4(position,1.);leafWorld=(modelMatrix*p).xyz;leafNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);leafTint=instanceColor;gl_Position=projectionMatrix*viewMatrix*vec4(leafWorld,1.);}`,fragmentShader:`precision highp float;uniform vec3 uSun,uSunTint,uAmbientTint;uniform float uDirect,uWet;uniform sampler2D leafMap;varying vec2 leafUV;varying vec3 leafWorld,leafNormal,leafTint;
 void main(){vec4 tex=texture2D(leafMap,leafUV);if(tex.a<.23)discard;vec3 n=normalize(leafNormal);if(!gl_FrontFacing)n=-n;vec3 sun=normalize(uSun);float front=max(dot(n,sun),0.);float back=max(dot(-n,sun),0.);
 vec3 offset=leafWorld-vec3(20.,6.8,-34.);float edge=smoothstep(1.3,4.2,length(offset*vec3(1.,.85,1.)));float openSky=smoothstep(4.0,9.1,leafWorld.y);float ao=.32+.40*edge+.28*openSky;
 float sunSide=smoothstep(-2.8,2.8,dot(offset,sun));float crownTransmission=mix(.38,1.,sunSide)*(.78+.22*edge);vec3 light=vec3(.33,.41,.29)*uAmbientTint+uSunTint*(front*.78+back*.36)*uDirect*crownTransmission;
 vec3 c=tex.rgb*leafTint*light*ao*(.64+.52*sunSide);c+=tex.rgb*uSunTint*.20*edge*sunSide*uDirect;
 gl_FragColor=vec4(pow(max(c,vec3(0.)),vec3(.4545)),1.);}`});
 const leaves=new T.InstancedMesh(leafGeo,leafMat,leafTransforms.length);leaves.instanceMatrix.setUsage(T.DynamicDrawUsage);leaves.frustumCulled=false;scene.add(leaves);
 const dummy=new T.Object3D(),world=new T.Vector3();
 leaves.castShadow=true;leaves.receiveShadow=true;
 leafTransforms.forEach((l,i)=>{leaves.setColorAt(i,new T.Color().setHSL(.12+rand()*.05,.10,.67+rand()*.26));});
 let cloud=productState.cloud,targetCloud=cloud,cloudFrom=cloud,cloudChanged=performance.now()-1000;let rain=Number(rainInput.value)/100,targetRain=rain,rainFrom=rain,rainChanged=performance.now()-1000,rainTime=0,cloudShift=0;
 rainUniforms.uRain.value=rain;
 let hour=Number(clockInput.value),targetHour=hour,hourFrom=hour,hourChanged=performance.now()-1000;applySolar(hour);
 let time=0,speed=productState.wind,target=productState.wind,windFrom=productState.wind,windChanged=performance.now()-1500,paused=productState.paused,near=false,last=0,raf=0,timer=0,visible=true,disposed=false,dirty=true,firstFrame=true;
 function setHour(value){
 const next=hour+(((value-hour+12)%24+24)%24-12);
 if(Math.abs(targetHour-next)>1e-7){hourFrom=hour;targetHour=next;hourChanged=performance.now();}
}
function leafUpdate(){tree.updateMatrixWorld(true);leafTransforms.forEach((l,i)=>{world.copy(l.p).applyMatrix4(l.parent.matrixWorld);dummy.position.copy(world);dummy.rotation.copy(l.rotation);dummy.rotation.z+=Math.sin(time*3.5+i*.71)*speed*.006;dummy.scale.setScalar(l.scale);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);});leaves.instanceMatrix.needsUpdate=true;}
 function render(){if(disposed||stopped)return;uniforms.uTime.value=time;uniforms.uWind.value=speed;rainUniforms.uRain.value=rain;rainUniforms.uRainTime.value=rainTime;rainUniforms.uRainWind.value=speed;rainScreen.visible=rain>0;skyMaterial.uniforms.uCloudShift.value=cloudShift;root.dataset.cloud=cloud.toFixed(3);root.dataset.paused=String(paused);root.dataset.cloudShift=cloudShift.toFixed(6);root.dataset.road="two-ruts";root.dataset.puddles=rain.toFixed(3);root.dataset.rainDepth="world";root.dataset.rainTime=rainTime.toFixed(3);root.dataset.rainWind=speed.toFixed(3);branches.forEach(b=>{b.pivot.rotation.z=b.z+Math.sin(time*1.1+b.phase)*speed*b.weight*.12;b.pivot.rotation.x=b.x+Math.sin(time*.78+b.phase)*speed*b.weight*.08;});leafUpdate();renderer.render(scene,camera);dirty=false;
 if(firstFrame){firstFrame=false;clearTimeout(loadTimer);if(view.querySelector('img'))view.querySelector('img').hidden=true;root.dataset.ready='true';root.dataset.state='ready';status.hidden=true;root.querySelectorAll('button,input').forEach(el=>el.disabled=false);labels();}}
 function size(){const w=view.clientWidth;if(!w)return;const ratio=Math.min(devicePixelRatio||1,mobile?1.3:1.5),rw=Math.min(1680,Math.max(1,Math.round(w*ratio))),rh=Math.round(rw*9/21);if(renderer.domElement.width!==rw||renderer.domElement.height!==rh){renderer.setPixelRatio(1);renderer.setSize(rw,rh,false);camera.aspect=21/9;camera.updateProjectionMatrix();dirty=true;}wake();}
 function labels(){pause.textContent=paused?'Продолжить':'Пауза';pause.setAttribute('aria-pressed',String(paused));}
 function cancelFrame(){cancelAnimationFrame(raf);clearTimeout(timer);raf=timer=0;last=0;}
 function animate(now){raf=0;if(!root.isConnected){release();return;}if(stopped||disposed||!visible||document.hidden){last=0;return;}const dt=last?Math.min((now-last)/1000,.5):0;last=now;
 if(cloud!==targetCloud){const ct=Math.min(1,Math.max(0,(now-cloudChanged)/650));cloud=ct===1?targetCloud:cloudFrom+(targetCloud-cloudFrom)*ct*ct*(3-2*ct);applySolar(hour);dirty=true;}const rt=Math.min(1,Math.max(0,(now-rainChanged)/650));if(rain!==targetRain){rain=rt===1?targetRain:rainFrom+(targetRain-rainFrom)*rt*rt*(3-2*rt);applySolar(hour);dirty=true;}
 if(!paused&&rain>0){rainTime+=dt;dirty=true;}
 const ht=Math.min(1,Math.max(0,(now-hourChanged)/240)),hourMoving=hour!==targetHour;if(hourMoving){hour=ht===1?targetHour:hourFrom+(targetHour-hourFrom)*ht*ht*(3-2*ht);applySolar(hour);dirty=true;}
 if(!paused&&(speed>0||target>0)){const t=Math.min(1,Math.max(0,(now-windChanged)/1000)),blend=t*t*(3-2*t);speed=t===1?target:windFrom+(target-windFrom)*blend;time+=dt*(.5+speed*.09);cloudShift+=dt*speed*.0015;dirty=true;}
 const began=performance.now();if(dirty||firstFrame)render();if(cloud!==targetCloud||hour!==targetHour||rain!==targetRain||(!paused&&(speed>0||target>0||rain>0)))timer=setTimeout(()=>{timer=0;wake();},Math.max(8,1000/30-(performance.now()-began)));}
 function wake(){if(!raf&&!timer&&!disposed&&!stopped&&visible&&productState.active&&!document.hidden)raf=requestAnimationFrame(animate);}
 rainInput.addEventListener('input',()=>{rainFrom=rain;targetRain=Number(rainInput.value)/100;rainChanged=performance.now();rainLabel();dirty=true;wake();},{signal:lifecycle.signal});
 clockInput.addEventListener('input',()=>{setHour(Number(clockInput.value));clockLabel();dirty=true;wake();},{signal:lifecycle.signal});
 slider.addEventListener('input',()=>{windFrom=speed;windChanged=performance.now();target=Number(slider.value);out.textContent=target===0?'Штиль · 0 м/с':target.toLocaleString('ru-RU')+' м/с';slider.setAttribute('aria-valuetext',out.textContent);if(paused)speed=target;dirty=true;wake();},{signal:lifecycle.signal});
 pause.addEventListener('click',()=>{paused=!paused;labels();if(paused){cancelFrame();if(hour!==targetHour||rain!==targetRain)wake();}else wake();},{signal:lifecycle.signal});
 close.addEventListener('click',()=>{near=!near;close.setAttribute('aria-pressed',String(near));close.textContent=near?'Весь пейзаж':'Колосья ближе';camera.fov=near?30:43;camera.position.set(near?-.15:0,near?1.5:1.65,near?5.2:6);camera.lookAt(near?.2:0,near?1.05:.9,near?-3:-35);camera.updateProjectionMatrix();dirty=true;wake();},{signal:lifecycle.signal});
 applyProduct=()=>{
   const p=productState;
   setHour(p.hour);
   if(targetRain!==p.rain){rainFrom=rain;targetRain=p.rain;rainChanged=performance.now();}
   if(target!==p.wind){windFrom=speed;target=p.wind;windChanged=performance.now();if(p.paused)speed=target;}
   if(targetCloud!==p.cloud){cloudFrom=cloud;targetCloud=p.cloud;cloudChanged=performance.now();}paused=p.paused;dirty=true;labels();
   if(!p.active)cancelFrame();else wake();
 };
 const reduced=matchMedia('(prefers-reduced-motion:reduce)');reduced.addEventListener('change',()=>{if(reduced.matches){paused=true;labels();cancelFrame();}},{signal:lifecycle.signal});
 const resizeObserver=new ResizeObserver(size),visibilityObserver=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)wake();else cancelFrame();});resizeObserver.observe(view);visibilityObserver.observe(root);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelFrame();else wake();},{signal:lifecycle.signal});
 release=()=>{if(disposed)return;disposed=true;cancelFrame();resizeObserver.disconnect();visibilityObserver.disconnect();const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());[leafTexture,barkTexture,wheatTexture,backdropTexture].forEach(t=>t.dispose());renderer.dispose();renderer.forceContextLoss();root.dataset.disposed='true';};
 renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();if(!disposed){cancelFrame();fail();}},{signal:lifecycle.signal});
 if(stopped||!root.isConnected){release();return;}applyProduct();root.dataset.plants=String(plants);root.dataset.leaves=String(leafTransforms.length);size();labels();dirty=true;wake();

 }catch(error){console.error(error);fail();}}
 // Initial embedding is static: no WebGL context, CDN request or animation loop until the user starts it.
 function launch(){if(launched||stopped)return;launched=true;root.dataset.state='loading';status.hidden=false;pause.disabled=true;loadTimer=setTimeout(fail,45000);setTimeout(()=>{if(stopped)return;if(window.THREE)start(window.THREE);else{const script=document.createElement('script');script.src='./three-0.160.1.min.js';script.onload=()=>{if(!stopped)start(window.THREE);};script.onerror=fail;document.head.appendChild(script);}},0);}
 rainInput.addEventListener('input',()=>{rainLabel();if(!launched)launch();},{signal:lifecycle.signal});
 clockInput.addEventListener('input',()=>{clockLabel();if(!launched)launch();},{signal:lifecycle.signal});root.dataset.state='idle';status.hidden=true;pause.disabled=false;pause.textContent='Включить ветер';pause.addEventListener('click',launch,{once:true,signal:lifecycle.signal});
 })();
 