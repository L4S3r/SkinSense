// ── STATE
var photoBase64=null, photoMimeType='image/jpeg', analysisOption='all';
var quizAnswers={}, photoResult=null, quizResult=null;
var stream=null, facingMode='user', countdownTimer=null, cdActive=false;
var inputSource='camera';

// ── QUESTIONS
var QUESTIONS=[
  {id:'morning',text:'How does your skin feel when you wake up in the morning?',options:['Very oily/shiny all over','Oily in T-zone, dry on cheeks','Tight or dry','Normal, comfortable','Irritated or sensitive']},
  {id:'midday',text:'By midday without skincare, your skin looks:',options:['Very shiny all over','Shiny only on T-zone','Still dry or flaky','Pretty much the same','Red or reactive']},
  {id:'pores',text:'How do your pores appear?',options:['Very visible and large','Visible mainly in T-zone','Barely visible / dry','Normal, not prominent','Variable, sometimes irritated']},
  {id:'moisturizer',text:'How does your skin react to moisturizer?',options:['Gets greasy immediately','Absorbs quickly, balanced','Soaks it up, still dry','Feels fine and comfortable','Sometimes causes redness']},
  {id:'climate',text:'In hot/humid weather your skin tends to:',options:['Become extremely oily','Get oily only in T-zone','Feel slightly better','Feel uncomfortable','Break out or become red']},
  {id:'breakouts',text:'How often do you experience breakouts?',options:['Frequently, all over','Mostly in T-zone','Rarely','Occasionally','Often, from products']},
  {id:'texture',text:'Describe your skin texture:',options:['Smooth but greasy','Mixed textures','Rough, flaky, or tight','Smooth and even','Bumpy or easily irritated']}
];

// ── QUIZ RENDER
function renderQuiz(){
  var g=document.getElementById('questionsGrid'); g.innerHTML='';
  QUESTIONS.forEach(function(q,i){
    var c=document.createElement('div'); c.className='question-card'; c.id='qcard-'+q.id;
    var opts=q.options.map(function(o,j){
      return '<button class="opt-btn" id="opt-'+q.id+'-'+j+'" onclick="selectAnswer(\''+q.id+'\',this)">' +o+'</button>';
    }).join('');
    c.innerHTML='<div class="q-label"><span class="q-num">'+(i+1)+'</span>'+q.text+'</div><div class="options-row">'+opts+'</div>';
    g.appendChild(c);
  });
}
renderQuiz();

function updateQuizProgress(){
  var n=Object.keys(quizAnswers).length;
  var el=document.getElementById('quizProgress');
  if(el) el.textContent=n+'/7 answered';
}

function selectAnswer(qId,btnEl){
  var value=btnEl.textContent.trim();
  quizAnswers[qId]=value;
  document.querySelectorAll('[id^="opt-'+qId+'-"]').forEach(function(b){b.classList.remove('selected');});
  btnEl.classList.add('selected');
  var card=document.getElementById('qcard-'+qId);
  if(card) card.classList.add('answered');
  updateQuizProgress();
}

// ── TABS
function switchTab(tab){
  document.getElementById('panelPhoto').style.display  = tab==='photo'  ? '' : 'none';
  document.getElementById('panelQuiz').style.display   = tab==='quiz'   ? '' : 'none';
  document.getElementById('panelResult').style.display = tab==='result' ? '' : 'none';
  document.getElementById('loader').style.display='none';
  ['photo','quiz','result'].forEach(function(t){
    var btn=document.getElementById('tab'+t[0].toUpperCase()+t.slice(1));
    if(btn) btn.classList.toggle('active', t===tab);
  });
  if(tab==='quiz') updateQuizProgress();
}

// ── SOURCE TOGGLE (camera / upload)
function setSource(src){
  inputSource=src;
  document.getElementById('srcCamera').classList.toggle('active', src==='camera');
  document.getElementById('srcUpload').classList.toggle('active', src==='upload');
  document.getElementById('cameraMode').style.display  = src==='camera' ? '' : 'none';
  document.getElementById('uploadMode').style.display  = src==='upload' ? '' : 'none';
  if(src!=='camera' && stream) stopCamera();
}

// ── CAMERA
async function startCamera(){
  hideError('photoError');
  try{
    if(stream) stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:facingMode, width:{ideal:1280}, height:{ideal:720}}, audio:false
    });
    var vid=document.getElementById('camVideo');
    vid.srcObject=stream;
    vid.play();
    setCamStatus(true);
    document.getElementById('btnCapture').disabled=false;
    var startBtn=document.getElementById('btnStartCam');
    startBtn.textContent='Stop Camera';
    startBtn.onclick=stopCamera;
  } catch(e){
    showError('photoError','Camera error: '+e.message+'. Allow camera permissions, or use Upload instead.');
  }
}

function stopCamera(){
  if(stream){ stream.getTracks().forEach(function(t){t.stop();}); stream=null; }
  var vid=document.getElementById('camVideo'); vid.srcObject=null;
  setCamStatus(false);
  document.getElementById('btnCapture').disabled=true;
  var startBtn=document.getElementById('btnStartCam');
  startBtn.textContent='Start Camera';
  startBtn.onclick=startCamera;
}

function setCamStatus(on){
  var el=document.getElementById('camStatus');
  if(on){
    el.innerHTML='<span class="live-dot"></span>Live - align face in oval';
    el.className='cam-status ready';
  } else {
    el.innerHTML='<span class="live-dot"></span>Camera off';
    el.className='cam-status';
  }
}

async function flipCamera(){
  facingMode = facingMode==='user' ? 'environment' : 'user';
  if(stream) await startCamera();
}

// ── COUNTDOWN + CAPTURE
function startCountdown(){
  if(cdActive || !stream) return;
  cdActive=true;
  document.getElementById('btnCapture').disabled=true;
  var wrap=document.getElementById('countdownWrap');
  wrap.classList.add('active');
  var numEl=document.getElementById('cdNum');
  var prog=document.getElementById('cdProgress');
  var count=3; var circumference=283;
  numEl.textContent=count;
  prog.style.strokeDashoffset=circumference;

  function tick(){
    if(count<=0){
      clearInterval(countdownTimer);
      wrap.classList.remove('active');
      cdActive=false;
      capturePhoto();
      return;
    }
    numEl.textContent=count;
    prog.style.strokeDashoffset = circumference * (count/3);
    count--;
  }
  tick();
  countdownTimer=setInterval(tick, 1000);
}

function capturePhoto(){
  var vid=document.getElementById('camVideo');
  var canvas=document.getElementById('camCanvas');
  canvas.width  = vid.videoWidth  || 640;
  canvas.height = vid.videoHeight || 480;
  var ctx=canvas.getContext('2d');
  // un-mirror for natural capture
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);

  // Flash
  var flash=document.getElementById('flashOverlay');
  flash.classList.add('flash');
  setTimeout(function(){ flash.classList.remove('flash'); }, 150);

  var dataURL=canvas.toDataURL('image/jpeg', 0.92);
  photoBase64 = dataURL.split(',')[1];
  photoMimeType = 'image/jpeg';

  // Show captured preview
  document.getElementById('capturedImg').src=dataURL;
  document.getElementById('capturedTime').textContent=new Date().toLocaleTimeString();
  document.getElementById('capturedWrap').style.display='';

  // Re-enable capture & stop stream
  document.getElementById('btnCapture').disabled=false;
  stopCamera();
}

function retakePhoto(){
  photoBase64=null;
  document.getElementById('capturedWrap').style.display='none';
  document.getElementById('cdNum').textContent='3';
  document.getElementById('cdProgress').style.strokeDashoffset=283;
  startCamera();
}

// ── FILE UPLOAD FALLBACK
function handleFile(event){
  var file=event.target.files[0]; if(!file) return;
  if(file.size > 10*1024*1024){ showError('photoError','File too large. Max 10 MB.'); return; }
  photoMimeType=file.type||'image/jpeg';
  var reader=new FileReader();
  reader.onload=function(e){
    var dataURL=e.target.result;
    photoBase64=dataURL.split(',')[1];
    document.getElementById('previewImg').src=dataURL;
    document.getElementById('previewName').textContent=file.name;
    document.getElementById('uploadZone').style.display='none';
    document.getElementById('previewWrap').style.display='';
  };
  reader.readAsDataURL(file);
}

var zone=document.getElementById('uploadZone');
zone.addEventListener('dragover', function(e){ e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', function(){ zone.classList.remove('drag-over'); });
zone.addEventListener('drop', function(e){
  e.preventDefault(); zone.classList.remove('drag-over');
  var file=e.dataTransfer.files[0];
  if(file) handleFile({target:{files:[file]}});
});

function clearUpload(){
  photoBase64=null;
  document.getElementById('fileInput').value='';
  document.getElementById('previewWrap').style.display='none';
  document.getElementById('uploadZone').style.display='';
}

// ── ANALYSIS OPTION
function selectAnalysisOpt(opt){
  analysisOption=opt;
  ['all','oiliness','texture','sensitivity'].forEach(function(o){
    document.getElementById('opt-'+o).classList.toggle('selected', o===opt);
  });
}

// ── HELPERS
function showError(id,msg){ var el=document.getElementById(id); el.textContent='Warning: '+msg; el.style.display='block'; }
function hideError(id){ document.getElementById(id).style.display='none'; }
function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
function skinEmoji(t){ return {Oily:'💧',Dry:'🌵',Combination:'🌊',Normal:'✨',Sensitive:'🌸'}[t]||'🔬'; }

function setLoaderStep(n){
  var labels=['Sending image to GLM-4V...','Processing questionnaire data...','Determining skin type...','Generating recommendations...'];
  for(var i=1;i<=4;i++){
    var el=document.getElementById('ls'+i);
    if(i<n){ el.classList.add('active'); el.textContent='Done: '+labels[i-1]; }
    else if(i===n){ el.classList.add('active'); el.textContent='Working: '+labels[i-1]; }
    else{ el.classList.remove('active'); el.textContent='Waiting: '+labels[i-1]; }
  }
}

// ── GLM-4V API CALL
async function callGLM(payload){
  var apiKey=document.getElementById('apiKey').value.trim();
  if(!apiKey) throw new Error('Please enter your Zhipu AI API key.');
  var res=await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
    body:JSON.stringify(Object.assign({model:'glm-4v-flash',max_tokens:1500,temperature:0.3}, payload))
  });
  if(!res.ok){
    var err=await res.json().catch(function(){return{};});
    throw new Error((err&&err.error&&err.error.message)||'API error '+res.status);
  }
  var data=await res.json();
  return (data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'';
}

// ── PROMPTS
function buildPhotoPrompt(){
  var focusMap={
    all:'oiliness, hydration, pore size, texture, redness, and overall skin health',
    oiliness:'oiliness and sebum production',
    texture:'skin texture, roughness, and smoothness',
    sensitivity:'redness, irritation, and sensitivity indicators'
  };
  return 'You are an expert dermatologist. Analyze this face photo carefully.\n\nFocus on: '+focusMap[analysisOption]+'.\n\nClassify the skin type as exactly one of: Oily, Dry, Combination, Normal, Sensitive.\n\nReturn ONLY valid JSON with no markdown:\n{"skin_type":"Combination","confidence":82,"emoji":"wave","traits":{"oiliness":"Moderate T-zone","hydration":"Low on cheeks","pore_size":"Enlarged in T-zone","texture":"Smooth","redness":"Minimal"},"photo_analysis":"2-3 sentences describing observations.","recommendations":{"cleanser":["Gentle foaming cleanser","Avoid harsh sulfates"],"moisturizer":["Lightweight gel for T-zone","Richer cream on dry cheeks"],"sunscreen":["SPF 30+ daily","Gel formula"],"avoid":["Heavy oils","Alcohol toners"]}}';
}

function buildQuizPrompt(){
  var answers=QUESTIONS.map(function(q){ return '- '+q.text+'\n  Answer: '+(quizAnswers[q.id]||'Not answered'); }).join('\n');
  var ctx=photoResult ? '\n\nPhoto already determined: '+photoResult.skin_type+' skin ('+photoResult.confidence+'% confidence).' : '';
  return 'You are an expert dermatologist. Based on these answers, determine skin type.'+ctx+'\n\nAnswers:\n'+answers+'\n\nClassify as exactly one of: Oily, Dry, Combination, Normal, Sensitive.\n\nReturn ONLY valid JSON with no markdown:\n{"skin_type":"Combination","confidence":88,"emoji":"wave","traits":{"oiliness":"Moderate T-zone","hydration":"Low on cheeks","pore_size":"Normal","texture":"Mostly smooth","redness":"Minimal"},"quiz_analysis":"2-3 sentence explanation.","recommendations":{"cleanser":["Gentle balancing cleanser"],"moisturizer":["Lightweight gel for T-zone","Richer moisturizer for dry areas"],"sunscreen":["SPF 30+ every morning","Non-comedogenic formula"],"avoid":["Heavy oils on T-zone","Skipping moisturizer"]}}';
}

function parseGLMResponse(raw){
  var m=raw.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : raw);
}

function extractFallback(text){
  var lower=text.toLowerCase(), t='Normal';
  if(lower.includes('oily'))       t='Oily';
  else if(lower.includes('dry'))   t='Dry';
  else if(lower.includes('combin'))t='Combination';
  else if(lower.includes('sensit'))t='Sensitive';
  return {skin_type:t, confidence:70, emoji:skinEmoji(t),
    traits:{oiliness:'N/A',hydration:'N/A',pore_size:'N/A',texture:'N/A',redness:'N/A'},
    photo_analysis:text.substring(0,300), quiz_analysis:'',
    recommendations:{cleanser:['Use a gentle cleanser'],moisturizer:['Apply a suitable moisturizer'],sunscreen:['SPF 30+ daily'],avoid:['Harsh ingredients']}
  };
}

// ── MAIN FLOWS
async function startAnalysis(){
  hideError('photoError');
  var apiKey=document.getElementById('apiKey').value.trim();
  if(!apiKey){ showError('photoError','Please enter your API key first.'); return; }
  if(!photoBase64){ showError('photoError','Please capture a photo or upload an image first.'); return; }
  document.getElementById('panelPhoto').style.display='none';
  document.getElementById('loader').style.display='block';
  setLoaderStep(1);
  try{
    var messages=[{role:'user',content:[
      {type:'image_url', image_url:{url:'data:'+photoMimeType+';base64,'+photoBase64}},
      {type:'text', text:buildPhotoPrompt()}
    ]}];
    var raw=await callGLM({messages:messages});
    setLoaderStep(3);
    try{ photoResult=parseGLMResponse(raw); } catch(e){ photoResult=extractFallback(raw); }
    setLoaderStep(4); await sleep(500);
    document.getElementById('loader').style.display='none';
    switchTab('quiz');
  } catch(err){
    document.getElementById('loader').style.display='none';
    document.getElementById('panelPhoto').style.display='';
    showError('photoError', err.message);
  }
}

async function analyzeQuiz(){
  hideError('quizError');
  var apiKey=document.getElementById('apiKey').value.trim();
  if(!apiKey){ showError('quizError','Please enter your API key first.'); return; }
  var answered=Object.keys(quizAnswers).length;
  if(answered<5){ showError('quizError','Please answer at least 5 questions ('+answered+'/7 answered).'); return; }
  document.getElementById('panelQuiz').style.display='none';
  document.getElementById('loader').style.display='block';
  setLoaderStep(2);
  try{
    var raw=await callGLM({messages:[{role:'user',content:buildQuizPrompt()}]});
    setLoaderStep(3);
    try{ quizResult=parseGLMResponse(raw); } catch(e){ quizResult=extractFallback(raw); }
    setLoaderStep(4); await sleep(500);
    var final=mergeFinalResult(photoResult,quizResult);
    renderResult(final);
    document.getElementById('loader').style.display='none';
    switchTab('result');
  } catch(err){
    document.getElementById('loader').style.display='none';
    document.getElementById('panelQuiz').style.display='';
    showError('quizError', err.message);
  }
}

function mergeFinalResult(photo,quiz){
  if(!photo) return quiz; if(!quiz) return photo;
  var avg=Math.round((photo.confidence+quiz.confidence)/2);
  var type=photo.skin_type===quiz.skin_type ? quiz.skin_type : (quiz.confidence>=photo.confidence ? quiz.skin_type : photo.skin_type);
  return {
    skin_type:type, confidence:Math.min(avg+5,98),
    emoji: quiz.emoji||photo.emoji,
    traits: Object.assign({},photo.traits,quiz.traits),
    photo_analysis: photo.photo_analysis||'',
    quiz_analysis:  quiz.quiz_analysis||'',
    recommendations: quiz.recommendations||photo.recommendations
  };
}

// ── RENDER RESULT
function renderResult(result){
  var emojiMap={Oily:'💧',Dry:'🌵',Combination:'🌊',Normal:'✨',Sensitive:'🌸'};
  document.getElementById('resultEmoji').textContent = emojiMap[result.skin_type]||'🔬';
  document.getElementById('resultType').textContent  = result.skin_type||'Unknown';
  setTimeout(function(){
    document.getElementById('confBar').style.width  = (result.confidence||80)+'%';
    document.getElementById('confPct').textContent  = (result.confidence||80)+'%';
  }, 300);
  var tg=document.getElementById('traitsGrid'); tg.innerHTML='';
  var tIcons={oiliness:'💧',hydration:'🌊',pore_size:'🔬',texture:'🖐️',redness:'🌸'};
  var tLabels={oiliness:'Oiliness',hydration:'Hydration',pore_size:'Pore Size',texture:'Texture',redness:'Redness'};
  Object.keys(result.traits||{}).forEach(function(k,i){
    var c=document.createElement('div'); c.className='trait-card'; c.style.animationDelay=(i*0.08)+'s';
    c.innerHTML='<div class="trait-icon">'+(tIcons[k]||'~')+'</div><div class="trait-name">'+(tLabels[k]||k)+'</div><div class="trait-value">'+result.traits[k]+'</div>';
    tg.appendChild(c);
  });
  var rg=document.getElementById('recsGrid'); rg.innerHTML='';
  var rMeta={cleanser:{icon:'🧴',label:'Cleanser'},moisturizer:{icon:'💦',label:'Moisturizer'},sunscreen:{icon:'☀️',label:'Sun Protection'},avoid:{icon:'🚫',label:'What to Avoid'}};
  Object.keys(result.recommendations||{}).forEach(function(k,i){
    var m=rMeta[k]||{icon:'✨',label:k};
    var items=Array.isArray(result.recommendations[k]) ? result.recommendations[k] : [result.recommendations[k]];
    var c=document.createElement('div'); c.className='rec-card'; c.style.animationDelay=(i*0.1)+'s';
    c.innerHTML='<h4>'+m.icon+' '+m.label+'</h4><ul>'+items.map(function(it){return'<li>'+it+'</li>';}).join('')+'</ul>';
    rg.appendChild(c);
  });
  var parts=[];
  if(result.photo_analysis) parts.push('Photo Analysis:\n'+result.photo_analysis);
  if(result.quiz_analysis)  parts.push('Quiz Analysis:\n'+result.quiz_analysis);
  document.getElementById('aiFullText').textContent = parts.join('\n\n')||'Analysis complete.';
}

// ── RESET
function resetAll(){
  if(stream) stopCamera();
  photoBase64=null; photoMimeType='image/jpeg'; quizAnswers={}; photoResult=null; quizResult=null;
  document.getElementById('capturedWrap').style.display='none';
  document.getElementById('btnCapture').disabled=true;
  var startBtn=document.getElementById('btnStartCam');
  startBtn.textContent='Start Camera'; startBtn.onclick=startCamera;
  clearUpload(); renderQuiz(); setSource('camera'); switchTab('photo');
}

window.addEventListener('beforeunload', function(){ if(stream) stopCamera(); });