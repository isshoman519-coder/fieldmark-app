import { loadProjects, saveProject, removeProject } from './storage.js';
import { containRect, pointToNormalized, pointFromNormalized, distanceToSegment, validDimension } from './geometry.js';

const $ = id => document.getElementById(id);
const canvas = $('annotationCanvas');
const stage = $('canvasStage');
const ctx = canvas.getContext('2d');
const app = {
  projects: [], project: null, photoIndex: 0, image: null, imageRect: null,
  tool: 'select', draft: null, editingId: null, pointer: null,
  undo: [], saveTimeout: null, saveChain: Promise.resolve(), urls: new Map(),
};
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now = () => new Date().toISOString();
const currentPhoto = () => app.project?.photos[app.photoIndex] || null;
const shortDate = iso => new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(iso));
const cloneAnnotations = annotations => JSON.parse(JSON.stringify(annotations));
const cleanFilename = text => (text || '현장기록').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => el.classList.add('hidden'), 3500);
}

function toggleScreen(editing) {
  $('homeScreen').classList.toggle('hidden', editing);
  $('editorScreen').classList.toggle('hidden', !editing);
  window.scrollTo(0, 0);
}

function openDialog(id) { $(id).showModal(); }
function closeDialog(id) { if ($(id).open) $(id).close(); }

function getObjectUrl(photo) {
  if (!app.urls.has(photo.id)) app.urls.set(photo.id, URL.createObjectURL(photo.blob));
  return app.urls.get(photo.id);
}

function projectCard(project) {
  const article = document.createElement('article');
  article.className = 'project-card';
  const open = document.createElement('button');
  open.className = 'project-open';
  open.type = 'button';
  const cover = document.createElement('div');
  cover.className = 'project-cover';
  const image = project.photos[0];
  if (image?.blob) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = getObjectUrl(image);
    cover.append(img);
  } else {
    const symbol = document.createElement('span');
    symbol.className = 'cover-empty';
    symbol.textContent = '▧';
    cover.append(symbol);
  }
  const meta = document.createElement('div');
  meta.className = 'project-meta';
  const name = document.createElement('strong');
  name.textContent = project.title;
  const detail = document.createElement('span');
  detail.textContent = `${project.photos.length}장 · ${shortDate(project.updatedAt)}`;
  meta.append(name, detail);
  open.append(cover, meta);
  open.addEventListener('click', () => openProject(project.id));
  const del = document.createElement('button');
  del.className = 'project-delete';
  del.type = 'button';
  del.setAttribute('aria-label', `${project.title} 삭제`);
  del.title = '프로젝트 삭제';
  del.textContent = '×';
  del.addEventListener('click', async () => {
    if (!confirm(`“${project.title}” 프로젝트와 사진을 삭제할까요? 이 작업은 되돌릴 수 없어요.`)) return;
    await removeProject(project.id);
    app.projects = app.projects.filter(p => p.id !== project.id);
    renderProjects();
    toast('프로젝트를 삭제했어요.');
  });
  article.append(open, del);
  return article;
}

function renderProjects() {
  const parent = $('projectList');
  parent.replaceChildren();
  app.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const project of app.projects) parent.append(projectCard(project));
  $('emptyProjects').classList.toggle('hidden', app.projects.length > 0);
}

async function createProject(title, location='') {
  const project = { id:uuid(), title:title.trim(), location:location.trim(), createdAt:now(), updatedAt:now(), photos:[] };
  app.projects.unshift(project);
  await saveProject(project);
  openProject(project.id);
  toast('프로젝트를 만들었어요. 사진을 추가해 보세요.');
}

async function openProject(id) {
  await flushSave();
  app.project = app.projects.find(p => p.id === id);
  if (!app.project) return;
  app.photoIndex = 0;
  app.undo = [];
  app.draft = null;
  app.editingId = null;
  $('projectTitle').value = app.project.title;
  $('saveStatus').textContent = '기기에 자동 저장';
  toggleScreen(true);
  setTool('select');
  renderThumbnails();
  await selectPhoto(0);
}

function scheduleSave() {
  if (!app.project) return;
  app.project.updatedAt = now();
  $('saveStatus').textContent = '저장하는 중…';
  clearTimeout(app.saveTimeout);
  app.saveTimeout = setTimeout(() => { void flushSave(); }, 350);
}

async function flushSave() {
  clearTimeout(app.saveTimeout);
  if (!app.project || $('saveStatus').textContent !== '저장하는 중…') return app.saveChain;
  const project = structuredClone(app.project);
  app.saveChain = app.saveChain.then(() => saveProject(project)).then(() => {
    if (app.project?.id === project.id && app.project.updatedAt === project.updatedAt) $('saveStatus').textContent = '기기에 저장됨';
  }).catch(error => {
    $('saveStatus').textContent = '저장 실패';
    toast(`저장하지 못했어요: ${error.message}`);
  });
  return app.saveChain;
}

function renderThumbnails() {
  const list = $('thumbnailList');
  list.replaceChildren();
  const photos = app.project?.photos || [];
  photos.forEach((photo, index) => {
    const button = document.createElement('button');
    button.className = `thumbnail ${index === app.photoIndex ? 'active' : ''}`;
    button.type = 'button';
    button.setAttribute('aria-label', `${index + 1}번 사진 선택`);
    const img = document.createElement('img');
    img.src = getObjectUrl(photo);
    img.alt = '';
    button.append(img);
    button.addEventListener('click', () => selectPhoto(index));
    list.append(button);
  });
  $('photoPosition').textContent = `사진 ${photos.length ? app.photoIndex + 1 : 0} / ${photos.length}`;
  $('emptyCanvas').classList.toggle('hidden', photos.length > 0);
  $('shareImage').disabled = !photos.length;
  $('exportReport').disabled = !photos.length;
  $('undoAction').disabled = !app.undo.length;
}

async function selectPhoto(index) {
  app.photoIndex = index;
  app.undo = [];
  app.draft = null;
  const photo = currentPhoto();
  app.image = null;
  if (!photo) { renderThumbnails(); draw(); return; }
  const image = new Image();
  const expectedId = photo.id;
  image.onload = () => {
    if (currentPhoto()?.id !== expectedId) return;
    app.image = image;
    draw();
  };
  image.onerror = () => toast('이 사진을 열지 못했어요.');
  image.src = getObjectUrl(photo);
  renderThumbnails();
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const element = document.createElement('canvas');
  element.width = Math.max(1, Math.round(bitmap.width * ratio));
  element.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = element.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, element.width, element.height);
  context.drawImage(bitmap, 0, 0, element.width, element.height);
  bitmap.close?.();
  const blob = await new Promise(resolve => element.toBlob(resolve, 'image/jpeg', .88));
  if (!blob) throw new Error('사진을 처리하지 못했어요.');
  return blob;
}

async function addPhotos(files) {
  if (!app.project || !files.length) return;
  const validFiles = files.filter(file => file.type.startsWith('image/'));
  if (!validFiles.length) { toast('이미지 파일을 선택해주세요.'); return; }
  $('modeHint').textContent = '사진을 준비하는 중…';
  let added = 0;
  for (const file of validFiles) {
    try {
      const blob = await compressImage(file);
      app.project.photos.push({ id:uuid(), name:file.name, blob, annotations:[] });
      added++;
    } catch (error) { toast(`${file.name}: ${error.message}`); }
  }
  if (added) {
    scheduleSave();
    await selectPhoto(app.project.photos.length - added);
    toast(`${added}장 추가했어요.`);
  }
  $('modeHint').textContent = '치수선은 손가락으로 드래그하세요';
}

function setTool(tool) {
  app.tool = tool;
  app.draft = null;
  for (const button of document.querySelectorAll('[data-tool]')) button.classList.toggle('is-active', button.dataset.tool === tool);
  canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  $('modeHint').textContent = { select:'선을 누르면 내용을 수정할 수 있어요', dimension:'원하는 시작점부터 끝점까지 드래그', lshape:'대각선으로 드래그해 가로·세로 표시', note:'메모를 붙일 지점을 누르세요' }[tool];
  draw();
}

function drawArrow(ctx, x, y, angle, size) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + size * Math.cos(angle + .5), y + size * Math.sin(angle + .5));
  ctx.moveTo(x, y);
  ctx.lineTo(x + size * Math.cos(angle - .5), y + size * Math.sin(angle - .5));
  ctx.stroke();
}

function paintAnnotation(context, annotation, rect, scale=1) {
  if (annotation.type === 'lshape') {
    paintAnnotation(context,{type:'dimension',a:annotation.a,b:{x:annotation.b.x,y:annotation.a.y},value:annotation.valueWidth,unit:annotation.unit,color:annotation.color},rect,scale);
    paintAnnotation(context,{type:'dimension',a:{x:annotation.b.x,y:annotation.a.y},b:annotation.b,value:annotation.valueHeight,unit:annotation.unit,color:annotation.color},rect,scale);
    return;
  }
  const color = annotation.color || '#0a8589';
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 3 * scale;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const a = pointFromNormalized(annotation.a, rect);
  if (annotation.type === 'dimension') {
    const b = pointFromNormalized(annotation.b, rect);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    drawArrow(context, a.x, a.y, angle, 10*scale);
    drawArrow(context, b.x, b.y, angle + Math.PI, 10*scale);
    const label = annotation.value ? `${annotation.value} ${annotation.unit || 'cm'}` : '길이 입력';
    context.font = `700 ${13*scale}px -apple-system, sans-serif`;
    const width = context.measureText(label).width + 18*scale;
    const midX = (a.x + b.x)/2, midY = (a.y + b.y)/2 - 15*scale;
    context.fillStyle = 'rgba(255,255,255,.96)';
    context.beginPath(); context.roundRect(midX-width/2, midY-13*scale, width, 24*scale, 7*scale); context.fill();
    context.fillStyle = color;
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, midX, midY);
  } else {
    const text = (annotation.text || '').split('\n')[0].slice(0,34) || '메모';
    context.font = `700 ${12*scale}px -apple-system, sans-serif`;
    const width = Math.min(context.measureText(text).width + 26*scale, rect.width*.8);
    const x = Math.min(a.x+7*scale, rect.x+rect.width-width-5*scale);
    const y = Math.max(rect.y+5*scale, a.y-30*scale);
    context.fillStyle = 'rgba(255,255,255,.96)';
    context.beginPath(); context.roundRect(x, y, width, 30*scale, 8*scale); context.fill();
    context.strokeStyle = color; context.lineWidth = 1.5*scale; context.stroke();
    context.fillStyle = color;
    context.textAlign = 'left'; context.textBaseline = 'middle'; context.fillText(text, x+10*scale, y+15*scale, width-18*scale);
    context.beginPath(); context.arc(a.x,a.y,5*scale,0,2*Math.PI); context.fill();
  }
}

function renderPhoto(context, image, photo, width, height, { preview=false }={}) {
  context.fillStyle = '#ffffff';
  context.fillRect(0,0,width,height);
  const rect = containRect(image.naturalWidth, image.naturalHeight, width, height);
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  const scale = Math.max(1, rect.width / 1100);
  for (const annotation of photo.annotations) paintAnnotation(context, annotation, rect, scale);
  if (preview && app.draft) paintAnnotation(context, app.draft, rect, scale);
  return rect;
}

function draw() {
  const width = canvas.clientWidth || stage.clientWidth;
  const height = canvas.clientHeight || stage.clientHeight;
  if (!width || !height) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const pixelWidth = Math.round(width*pixelRatio), pixelHeight = Math.round(height*pixelRatio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
  ctx.clearRect(0,0,width,height);
  if (!app.image || !currentPhoto()) { app.imageRect = null; return; }
  app.imageRect = renderPhoto(ctx, app.image, currentPhoto(), width, height, { preview:true });
}

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x:event.clientX-bounds.left, y:event.clientY-bounds.top };
}

function hitAnnotation(point) {
  const rect = app.imageRect;
  if (!rect) return null;
  for (const annotation of [...currentPhoto().annotations].reverse()) {
    const a = pointFromNormalized(annotation.a, rect);
    if (annotation.type === 'note' && Math.hypot(a.x-point.x,a.y-point.y) < 35) return annotation;
    if (annotation.type === 'dimension') {
      const b = pointFromNormalized(annotation.b, rect);
      if (distanceToSegment(point,a,b) < 22) return annotation;
    }
    if (annotation.type === 'lshape') {
      const mid = pointFromNormalized({x:annotation.b.x,y:annotation.a.y},rect);
      const b = pointFromNormalized(annotation.b,rect);
      if (distanceToSegment(point,a,mid)<22 || distanceToSegment(point,mid,b)<22) return annotation;
    }
  }
  return null;
}

function openAnnotation(annotation, existing=false) {
  app.draft = annotation;
  app.editingId = existing ? annotation.id : null;
  $('annotationHeading').textContent = annotation.type === 'note' ? '현장 메모' : annotation.type === 'lshape' ? '가로·세로 실측값' : '치수선 입력';
  $('dimensionField').classList.toggle('hidden', annotation.type !== 'dimension');
  $('lShapeFields').classList.toggle('hidden', annotation.type !== 'lshape');
  $('noteField').classList.toggle('hidden', annotation.type !== 'note');
  $('deleteAnnotation').classList.toggle('hidden', !existing);
  $('dimensionValue').value = annotation.value || '';
  $('dimensionUnit').value = annotation.unit || 'cm';
  $('widthValue').value = annotation.valueWidth || '';
  $('heightValue').value = annotation.valueHeight || '';
  $('lShapeUnit').value = annotation.unit || 'cm';
  $('noteValue').value = annotation.text || '';
  $('annotationColor').value = annotation.color || '#0a8589';
  openDialog('annotationDialog');
  if (annotation.type === 'dimension') $('dimensionValue').focus();
  else if (annotation.type === 'lshape') $('widthValue').focus();
  else $('noteValue').focus();
}

function rememberUndo() {
  if (!currentPhoto()) return;
  app.undo.push(cloneAnnotations(currentPhoto().annotations));
  if (app.undo.length > 30) app.undo.shift();
  $('undoAction').disabled = !app.undo.length;
}

function onPointerDown(event) {
  if (!app.image || !app.imageRect) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const point = pointerPosition(event);
  const rect = app.imageRect;
  if (point.x < rect.x || point.x > rect.x+rect.width || point.y < rect.y || point.y > rect.y+rect.height) return;
  const norm = pointToNormalized(point.x,point.y,rect);
  if (app.tool === 'select') {
    const annotation = hitAnnotation(point);
    if (annotation) openAnnotation({ ...annotation }, true);
    return;
  }
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  app.pointer = { id:event.pointerId, start:point };
  if (app.tool === 'dimension') app.draft = { id:uuid(), type:'dimension', a:norm, b:norm, value:'', unit:'cm', color:'#0a8589' };
  if (app.tool === 'lshape') app.draft = { id:uuid(), type:'lshape', a:norm, b:norm, valueWidth:'', valueHeight:'', unit:'cm',color:'#0a8589' };
  if (app.tool === 'note') app.draft = { id:uuid(), type:'note', a:norm, text:'', color:'#0a8589' };
  draw();
}

function onPointerMove(event) {
  if (!app.pointer || app.pointer.id !== event.pointerId || !app.draft || !app.imageRect) return;
  if (app.draft.type === 'dimension' || app.draft.type === 'lshape') {
    const point = pointerPosition(event);
    app.draft.b = pointToNormalized(point.x,point.y,app.imageRect);
    draw();
  }
}

function onPointerUp(event) {
  if (!app.pointer || app.pointer.id !== event.pointerId || !app.draft) return;
  const start = app.pointer.start;
  const end = pointerPosition(event);
  app.pointer = null;
  if ((app.draft.type === 'dimension' || app.draft.type === 'lshape') && Math.hypot(end.x-start.x,end.y-start.y) < 15) {
    app.draft = null;
    toast('치수선은 시작점부터 끝점까지 드래그해주세요.');
    draw();
    return;
  }
  const annotation = app.draft;
  openAnnotation(annotation, false);
}

async function exportImage() {
  if (!app.image || !currentPhoto()) return;
  const scale = Math.min(1, 2400/Math.max(app.image.naturalWidth,app.image.naturalHeight));
  const output = document.createElement('canvas');
  output.width = Math.round(app.image.naturalWidth*scale);
  output.height = Math.round(app.image.naturalHeight*scale);
  renderPhoto(output.getContext('2d'),app.image,currentPhoto(),output.width,output.height);
  const blob = await new Promise(resolve => output.toBlob(resolve,'image/png'));
  if (!blob) { toast('이미지를 만들지 못했어요.'); return; }
  const filename = `${cleanFilename(app.project.title)}_${app.photoIndex+1}.png`;
  const file = new File([blob],filename,{ type:'image/png' });
  if (navigator.canShare?.({ files:[file] })) {
    try { await navigator.share({ files:[file], title:app.project.title }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  downloadBlob(blob, filename);
  toast('이미지로 저장했어요.');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function drawImageForReport(image,photo) {
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1,1500/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width = Math.round(image.naturalWidth*ratio);
  canvas.height = Math.round(image.naturalHeight*ratio);
  renderPhoto(canvas.getContext('2d'),image,photo,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg', .83);
}

function loadImage(blob) {
  return new Promise((resolve,reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진 읽기 실패')); };
    image.src = url;
  });
}

async function printReport() {
  closeDialog('reportDialog');
  if (!app.project?.photos.length) return;
  await flushSave();
  const container = $('printReport');
  container.replaceChildren();
  try {
    for (const [i,photo] of app.project.photos.entries()) {
      const image = await loadImage(photo.blob);
      const page = document.createElement('article');
      page.className = 'report-page';
      const header = document.createElement('header');
      header.className = 'report-header';
      const heading = document.createElement('h1');
      heading.textContent = app.project.title;
      const location = document.createElement('p');
      location.textContent = `${app.project.location || '위치 미기재'} · ${shortDate(app.project.createdAt)} · ${i+1}/${app.project.photos.length}`;
      header.append(heading,location);
      const photoImg = document.createElement('img');
      photoImg.src = drawImageForReport(image,photo);
      photoImg.alt = `현장 사진 ${i+1}`;
      const notes = photo.annotations.filter(a=>a.type==='note').map((a,index)=>`${index+1}. ${a.text}`).join('\n');
      const caption = document.createElement('p');
      caption.className = 'report-caption';
      caption.textContent = `${photo.name}${notes ? `\n메모: ${notes}` : ''}`;
      const footer = document.createElement('p');
      footer.className = 'report-footer';
      footer.textContent = 'FIELD MARK · 직접 입력한 치수이며 자동 측정값이 아닙니다.';
      page.append(header,photoImg,caption,footer);
      container.append(page);
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    window.print();
  } catch (error) { toast(`보고서를 만들지 못했어요: ${error.message}`); }
}

const fileAsDataUrl = blob => new Promise((resolve,reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

async function exportBackup() {
  if (!app.project) return;
  await flushSave();
  const project = app.project;
  const photos = await Promise.all(project.photos.map(async p=>({ id:p.id,name:p.name,annotations:p.annotations,dataUrl:await fileAsDataUrl(p.blob) })));
  const backup = { format:'fieldmark-backup',version:1,project:{ id:project.id,title:project.title,location:project.location,createdAt:project.createdAt,updatedAt:project.updatedAt,photos } };
  downloadBlob(new Blob([JSON.stringify(backup)],{type:'application/json'}),`${cleanFilename(project.title)}.fieldmark.json`);
  toast('백업 파일을 저장했어요.');
}

async function importBackup(file) {
  if (!file || file.size > 75*1024*1024) { toast('75MB 이하의 백업 파일만 불러올 수 있어요.'); return; }
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'fieldmark-backup' || data.version !== 1 || !data.project || !Array.isArray(data.project.photos)) throw new Error('백업 형식이 올바르지 않아요.');
    if (data.project.photos.length > 100) throw new Error('백업 사진 수가 너무 많아요.');
    const photos = [];
    for (const photo of data.project.photos) {
      if (typeof photo.dataUrl !== 'string' || !photo.dataUrl.startsWith('data:image/')) throw new Error('사진 데이터가 올바르지 않아요.');
      const blob = await (await fetch(photo.dataUrl)).blob();
      photos.push({ id:uuid(),name:String(photo.name||'사진').slice(0,150),blob,annotations:Array.isArray(photo.annotations)?photo.annotations:[] });
    }
    const project = { id:uuid(),title:String(data.project.title||'복원된 현장').slice(0,80),location:String(data.project.location||'').slice(0,150),createdAt:now(),updatedAt:now(),photos };
    app.projects.unshift(project);
    await saveProject(project);
    renderProjects();
    toast('프로젝트 백업을 복원했어요.');
  } catch (error) { toast(`불러오기 실패: ${error.message}`); }
}

function bindEvents() {
  for (const id of ['newProjectHero','newProjectSmall']) $(id).addEventListener('click',()=>{ $('newProjectForm').reset();openDialog('newProjectDialog'); });
  $('newProjectForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const title=$('newTitle').value.trim();
    if(!title)return;
    closeDialog('newProjectDialog');
    await createProject(title,$('newLocation').value);
  });
  for(const button of document.querySelectorAll('[data-close]')) button.addEventListener('click',()=>closeDialog(button.dataset.close));
  $('backHome').addEventListener('click',async()=>{
    await flushSave();
    app.project=null;
    app.image=null;
    toggleScreen(false);
    renderProjects();
  });
  $('projectTitle').addEventListener('input',()=>{
    if(!app.project)return;
    app.project.title=$('projectTitle').value.trim() || '제목 없는 현장';
    scheduleSave();
  });
  for(const id of ['addFirstPhoto','addPhoto']) $(id).addEventListener('click',()=>$('photoInput').click());
  $('photoInput').addEventListener('change',async event=>{
    const files=[...event.target.files];
    event.target.value='';
    await addPhotos(files);
  });
  document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>setTool(button.dataset.tool)));
  canvas.addEventListener('pointerdown',onPointerDown);
  canvas.addEventListener('pointermove',onPointerMove);
  canvas.addEventListener('pointerup',onPointerUp);
  canvas.addEventListener('pointercancel',()=>{app.pointer=null;app.draft=null;draw();});
  $('annotationForm').addEventListener('submit',event=>{
    event.preventDefault();
    const annotation=app.draft;
    if(!annotation)return;
    if(annotation.type==='dimension'){
      if(!validDimension($('dimensionValue').value)){toast('0보다 큰 치수를 입력해주세요.');return;}
      annotation.value=String(Number($('dimensionValue').value));
      annotation.unit=$('dimensionUnit').value;
    }else if(annotation.type==='lshape'){
      if(!validDimension($('widthValue').value)||!validDimension($('heightValue').value)){
        toast('가로·세로에 각각 0보다 큰 치수를 입력해주세요.');return;
      }
      annotation.valueWidth=String(Number($('widthValue').value));
      annotation.valueHeight=String(Number($('heightValue').value));
      annotation.unit=$('lShapeUnit').value;
    }else{
      if(!$('noteValue').value.trim()){toast('메모 내용을 입력해주세요.');return;}
      annotation.text=$('noteValue').value.trim();
    }
    annotation.color=$('annotationColor').value;
    rememberUndo();
    if(app.editingId){
      const index=currentPhoto().annotations.findIndex(a=>a.id===app.editingId);
      if(index>=0) currentPhoto().annotations[index]=annotation;
    }else currentPhoto().annotations.push(annotation);
    app.draft=null;app.editingId=null;
    closeDialog('annotationDialog');
    scheduleSave();draw();
  });
  $('deleteAnnotation').addEventListener('click',()=>{
    if(!app.editingId||!currentPhoto())return;
    rememberUndo();
    currentPhoto().annotations=currentPhoto().annotations.filter(a=>a.id!==app.editingId);
    app.draft=null;app.editingId=null;
    closeDialog('annotationDialog');
    scheduleSave();draw();
  });
  $('annotationDialog').addEventListener('close',()=>{app.draft=null;app.editingId=null;draw();});
  $('undoAction').addEventListener('click',()=>{
    if(!currentPhoto()||!app.undo.length)return;
    currentPhoto().annotations=app.undo.pop();
    $('undoAction').disabled=!app.undo.length;
    scheduleSave();draw();
  });
  $('shareImage').addEventListener('click',()=>void exportImage());
  $('exportReport').addEventListener('click',()=>openDialog('reportDialog'));
  $('confirmReport').addEventListener('click',()=>void printReport());
  $('backupProject').addEventListener('click',()=>void exportBackup());
  $('backupImport').addEventListener('click',()=>$('backupInput').click());
  $('backupInput').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';
    if(file)await importBackup(file);
  });
  $('removePhoto').addEventListener('click',async()=>{
    const photo=currentPhoto();
    if(!photo||!confirm('현재 사진과 기록을 삭제할까요?'))return;
    const url=app.urls.get(photo.id);
    if(url){URL.revokeObjectURL(url);app.urls.delete(photo.id);}
    app.project.photos.splice(app.photoIndex,1);
    app.photoIndex=Math.max(0,Math.min(app.photoIndex,app.project.photos.length-1));
    scheduleSave();
    await selectPhoto(app.photoIndex);
  });
  new ResizeObserver(draw).observe(stage);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden')void flushSave();
  });
}

async function main() {
  bindEvents();
  try { app.projects=await loadProjects();renderProjects(); }
  catch(error){toast(`로컬 저장소를 열 수 없어요: ${error.message}`);}
  if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

void main();
