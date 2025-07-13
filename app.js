const API_BASE_URL = window.SD_CONFIG.API_BASE_URL

// 全局状态
let activeTab = 'txt2img';
let pngInfoParams = null; // 用于存储从PNG解析的参数
let imageHistory = []; // {src, info, params}
let currentSelectedGalleryIndex = -1;
let errorTimeoutId = null; 


// --- 初始化 ---
window.onload = async () => {
	setupAdvancedParameters();
	await Promise.all([ loadModels(), loadSamplers() ]);
	setupEventListeners();
	openTab('txt2img'); 
};

// --- UI 设置 ---
function setupAdvancedParameters() {
	const template = document.getElementById('advanced-parameters-template').innerHTML;
	document.getElementById('common-parameters-t2i').innerHTML = template;
	const i2iContainer = document.getElementById('common-parameters-i2i');
	i2iContainer.innerHTML = template;
	const denoisingGroup = document.createElement('div');
	denoisingGroup.className = 'slider-group';
	denoisingGroup.innerHTML = `
		<label>去噪强度</label>
		<div class="slider-container">
			<input type="range" id="denoising_strength" data-param-key="denoising_strength" min="0" max="1" step="0.01" value="0.75">
			<span class="slider-value" data-param-key="denoising_strength-value">0.75</span>
		</div>
	`;
	i2iContainer.querySelector('.i2i-specific-params').appendChild(denoisingGroup);
}

// --- API 调用 ---
async function loadModels() {
	try {
		const response = await fetch(`${API_BASE_URL}/sdapi/v1/sd-models`);
		if (!response.ok) throw new Error(`API错误: ${response.status}`);
		const models = await response.json();
		const select = document.getElementById('model-select');
		select.innerHTML = '';
		if (models.length > 0) {
			models.forEach(model => {
				const option = document.createElement('option');
				option.value = model.model_name;
				option.textContent = model.title;
				select.appendChild(option);
			});
		} else {
			select.innerHTML = '<option>无可用模型</option>';
		}
	} catch (error) {
		console.error('加载模型失败:', error);
		document.getElementById('model-select').innerHTML = '<option>加载失败</option>';
	}
}

async function loadSamplers() {
	try {
		const response = await fetch(`${API_BASE_URL}/sdapi/v1/samplers`);
		if (!response.ok) throw new Error(`API错误: ${response.status}`);
		const samplers = await response.json();
		const selects = document.querySelectorAll('.sampler-select-class');
		selects.forEach(select => {
			select.innerHTML = '';
			samplers.forEach(sampler => {
				const option = document.createElement('option');
				option.value = sampler.name;
				option.textContent = sampler.name;
				if (sampler.name === "DPM++ 2M Karras") {
					option.selected = true;
				}
				select.appendChild(option);
			});
		});
	} catch (error) {
		console.error('加载采样器失败:', error);
		document.querySelectorAll('.sampler-select-class').forEach(s => s.innerHTML = '<option>加载失败</option>');
	}
}

// --- 事件处理 ---
function setupEventListeners() {
	document.querySelectorAll('input[type="range"]').forEach(slider => {
		const valueDisplay = slider.parentElement.querySelector('.slider-value');
		if (valueDisplay) {
			valueDisplay.textContent = slider.value;
			slider.addEventListener('input', (event) => {
				valueDisplay.textContent = event.target.value;
			});
		}
	});

	document.querySelectorAll('.image-upload-box').forEach(box => {
		const input = box.querySelector('input[type="file"]');
		['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
			box.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false);
		});
		['dragenter', 'dragover'].forEach(eventName => {
			box.addEventListener(eventName, () => box.classList.add('dragover'), false);
		});
		['dragleave', 'drop'].forEach(eventName => {
			box.addEventListener(eventName, () => box.classList.remove('dragover'), false);
		});
		box.addEventListener('drop', e => {
			if (e.dataTransfer.files && e.dataTransfer.files[0]) {
				input.files = e.dataTransfer.files;
				input.dispatchEvent(new Event('change', { bubbles: true }));
			}
		}, false);
	});
}

function openTab(tabName) {
	activeTab = tabName;
	document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
	document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
	document.getElementById(tabName).classList.add('active');
	document.querySelector(`.tab-button[onclick="openTab('${tabName}')"]`).classList.add('active');
}

function handleImageUpload(event, previewId) {
	const file = event.target.files[0];
	const uploadBox = event.target.closest('.image-upload-box');
	const uploadText = uploadBox.querySelector('span');
	
	if (file) {
		const reader = new FileReader();
		reader.onload = e => {
			const preview = document.getElementById(previewId);
			preview.src = e.target.result;
			preview.style.display = 'block';
			if (uploadText) uploadText.style.display = 'none';
		};
		reader.readAsDataURL(file);
	}
}

async function handlePngInfoUpload(event) {
	const file = event.target.files[0];
	if (!file) return;

	handleImageUpload(event, 'png-info-preview');
	const outputDiv = document.getElementById('png-info-output');
	outputDiv.textContent = '正在解析...';
	pngInfoParams = null;

	try {
		const base64Image = await fileToBase64(file).then(res => res.split(',')[1]);
		const response = await fetch(`${API_BASE_URL}/sdapi/v1/png-info`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ image: `data:image/png;base64,${base64Image}` })
		});
		if (!response.ok) {
			throw new Error((await response.json()).detail || '解析失败');
		}
		const data = await response.json();
		outputDiv.textContent = data.info || '图片中未找到生成参数。';
		if (data.info) {
		   pngInfoParams = parseGenerationInfo(data.info);
		}
	} catch (error) {
		outputDiv.textContent = `解析错误: ${error.message}`;
		pngInfoParams = null;
	}
}

// --- 参数填充功能 ---
function populateForm(params, destinationTabId) {
	if (!params) return;
	const form = document.getElementById(destinationTabId);
	if (!form) return;

	const fieldMap = {
		Prompt: destinationTabId === 'txt2img' ? '#prompt' : '#i2i-prompt',
		NegativePrompt: destinationTabId === 'txt2img' ? '#negative_prompt' : '#i2i-negative_prompt',
		Sampler: '.sampler-select-class',
		Steps: '[data-param-key="steps"]',
		CfgScale: '[data-param-key="cfg_scale"]',
		Seed: '[data-param-key="seed"]',
		Width: '[data-param-key="width"]',
		Height: '[data-param-key="height"]',
		DenoisingStrength: '[data-param-key="denoising_strength"]',
		Model: '#model-select'
	};

	for (const [paramKey, value] of Object.entries(params)) {
		 const selector = fieldMap[paramKey];
		 if (selector) {
			const field = form.querySelector(selector);
			if (field) {
				if (field.tagName === 'SELECT') {
					 let optionFound = false;
					 for (let option of field.options) {
						 if (option.value === value || option.text === value) {
							 field.value = option.value;
							 optionFound = true;
							 break;
						 }
					 }
					 if (!optionFound && paramKey === 'Model') {
						 for (let option of field.options) {
							 if (option.value.includes(value) || option.text.includes(value)) {
								 field.value = option.value;
								 break;
							 }
						 }
					 }
				} else {
					field.value = value;
				}
				if (field.type === 'range') {
					field.dispatchEvent(new Event('input', { bubbles: true }));
				}
			}
		 }
	}
}

function sendTo(destination) {
	if (!pngInfoParams) {
		alert('请先上传图片并成功解析参数！');
		return;
	}
	
	openTab(destination);
	populateForm(pngInfoParams, destination);
	
	if (destination === 'img2img') {
		const pngPreviewSrc = document.getElementById('png-info-preview').src;
		if(pngPreviewSrc) {
			setImageForImg2Img(pngPreviewSrc);
		}
	}
	alert(`参数已成功发送到 "${destination}"!`);
}

async function generateImage() {
	const form = document.getElementById(activeTab);
	const payload = { override_settings: {} };
	
	payload.override_settings.sd_model_checkpoint = document.getElementById('model-select').value;

	if (activeTab === 'txt2img') {
		payload.prompt = form.querySelector('#prompt').value;
		payload.negative_prompt = form.querySelector('#negative_prompt').value;
	} else {
		payload.prompt = form.querySelector('#i2i-prompt').value;
		payload.negative_prompt = form.querySelector('#i2i-negative_prompt').value;
	}

	if (!payload.prompt) { showError('请输入正面提示词'); return; }
	
	payload.sampler_name = form.querySelector('.sampler-select-class').value;
	payload.steps = parseInt(form.querySelector('[data-param-key="steps"]').value);
	payload.cfg_scale = parseFloat(form.querySelector('[data-param-key="cfg_scale"]').value);
	payload.width = parseInt(form.querySelector('[data-param-key="width"]').value);
	payload.height = parseInt(form.querySelector('[data-param-key="height"]').value);
	payload.seed = parseInt(form.querySelector('[data-param-key="seed"]').value);
	
	if (activeTab === 'img2img') {
		const imageInput = form.querySelector('#i2i-image-upload input');
		const i2iPreview = document.getElementById('i2i-image-preview');
		const maskInput = form.querySelector('#i2i-mask-upload input');
		
		let initImageBase64 = '';
		if (imageInput.files[0]) {
			initImageBase64 = await fileToBase64(imageInput.files[0]);
		} else if (i2iPreview.src && i2iPreview.src.startsWith('data:image')) {
			initImageBase64 = i2iPreview.src;
		} else {
			showError('图生图模式下必须提供初始图片'); return;
		}
		
		payload.init_images = [initImageBase64];
		if (maskInput.files[0]) {
			payload.mask = await fileToBase64(maskInput.files[0]);
		}
		payload.denoising_strength = parseFloat(form.querySelector('#denoising_strength').value);
	}

	setLoading(true);

	try {
		const endpoint = activeTab === 'txt2img' ? '/sdapi/v1/txt2img' : '/sdapi/v1/img2img';
		const response = await fetch(`${API_BASE_URL}${endpoint}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			throw new Error((await response.json()).detail || `服务器错误: ${response.status}`);
		}

		const data = await response.json();
		if (data.images && data.images[0]) {
			const imageSrc = `data:image/png;base64,${data.images[0]}`;
			const imageParams = parseGenerationInfo(data.info);
			
			const historyEntry = { src: imageSrc, info: data.info, params: imageParams };
			const newImageIndex = imageHistory.push(historyEntry) - 1;

			addImageToGallery(newImageIndex, imageSrc);
			selectGalleryImage(newImageIndex, () => {
				setLoading(false);
			});
		} else {
			throw new Error('API 返回结果中没有图片');
		}
	} catch (err) {
		console.error('生成过程出错:', err);
		showError(`生成失败: ${err.message}`);
		setLoading(false);
	}
}


// --- UI 工具函数 ---
function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.readAsDataURL(file);
		reader.onload = () => resolve(reader.result);
		reader.onerror = error => reject(error);
	});
}

function setLoading(isLoading) {
	document.getElementById('loading-spinner').style.display = isLoading ? 'block' : 'none';
	document.querySelectorAll('.generate-btn').forEach(btn => btn.disabled = isLoading);
	if (isLoading) {
		document.getElementById('error-message').style.display = 'none';
		document.getElementById('gallery-container').style.display = 'none';
		document.getElementById('placeholder').style.display = 'none';
	}
}

function showError(message) {
    // 如果已有正在倒计时的隐藏任务，先取消它
    if (errorTimeoutId) {
        clearTimeout(errorTimeoutId);
    }

    const errorDiv = document.getElementById('error-message');
	const userTip = document.querySelector('.user-tip');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';

    // 保持你原有的逻辑，根据历史记录决定显示画廊还是占位符
    if (imageHistory.length === 0) {
        document.getElementById('placeholder').style.display = 'flex';
        document.getElementById('gallery-container').style.display = 'none';
        // 显示用户提示  
        if (userTip) {
            userTip.style.display = 'block';
        }
    } else {
        document.getElementById('placeholder').style.display = 'none';
        document.getElementById('gallery-container').style.display = 'flex';
        // 隐藏用户提示
        if (userTip) {
            userTip.style.display = 'none';
        }
    }

    // 设置一个新的计时器，在5秒后自动隐藏错误提示
    errorTimeoutId = setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000); // 5000毫秒 = 5秒，你可以按需调整这个时间
}

// --- 画廊相关函数 ---
function addImageToGallery(index, src) {
	const thumbnailsContainer = document.getElementById('gallery-thumbnails');
	const thumb = document.createElement('img');
	thumb.src = src;
	thumb.className = 'thumbnail-item';
	thumb.dataset.index = index;
	thumb.onclick = () => selectGalleryImage(index);
	thumbnailsContainer.appendChild(thumb);
}

function selectGalleryImage(index, onLoadCallback = null) {
	if (index < 0 || index >= imageHistory.length) {
		if (onLoadCallback) onLoadCallback(); // 如果索引无效，也应调用回调以避免UI卡死
		return;
	}
	
	currentSelectedGalleryIndex = index;

	const mainImage = document.getElementById('gallery-main-image');

	// --- 核心改动 ---
	// 设置 onload 和 onerror 处理器
	const handleLoad = () => {
		// 图片成功加载后，显示画廊并执行回调
		document.getElementById('placeholder').style.display = 'none';
		document.getElementById('gallery-container').style.display = 'flex';
		document.querySelector('.gallery-actions').style.display = 'flex';
		
		// 隐藏用户提示
		const userTip = document.querySelector('.user-tip');
		if (userTip) {
			userTip.style.display = 'none';
		}

		if (onLoadCallback) {
			onLoadCallback();
		}

		// 清理事件监听器，防止内存泄漏
		mainImage.onload = null;
		mainImage.onerror = null;
	};

	const handleError = () => {
		// 图片加载失败
		showError('浏览器渲染图片失败。');
		if (onLoadCallback) {
			onLoadCallback(); // 同样需要调用回调来结束加载状态
		}
		// 清理事件监听器
		mainImage.onload = null;
		mainImage.onerror = null;
	};

	mainImage.onload = handleLoad;
	mainImage.onerror = handleError;
	
	// 在设置完事件监听器后，再设置 src 属性来触发加载
	mainImage.src = imageHistory[index].src;

	// 更新缩略图的状态 (这部分可以立即执行)
	document.querySelectorAll('.thumbnail-item').forEach(thumb => {
		thumb.classList.toggle('active', parseInt(thumb.dataset.index) === index);
	});

	const activeThumb = document.querySelector(`.thumbnail-item[data-index='${index}']`);
	if(activeThumb) {
		activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
	}
}

function sendGalleryImageTo(destination) {
	if (currentSelectedGalleryIndex < 0) return alert("请先在画廊中选择一张图片!");
	const { params, src } = imageHistory[currentSelectedGalleryIndex];
	if (!params) return alert("无法从此图片中读取参数。");

	openTab(destination);
	populateForm(params, destination);

	if (destination === 'img2img' && src) {
		setImageForImg2Img(src);
	}
	alert(`参数已成功发送到 "${destination}"!`);
}

function setImageForImg2Img(src) {
	const i2iPreview = document.getElementById('i2i-image-preview');
	const i2iUploadBox = document.getElementById('i2i-image-upload');
	const i2iInput = i2iUploadBox.querySelector('input');
	i2iInput.value = ''; // 清空文件选择，避免冲突
	i2iPreview.src = src;
	i2iPreview.style.display = 'block';
	i2iUploadBox.querySelector('span').style.display = 'none';
}

// --- 【已修复】智能解析函数 ---
function parseGenerationInfo(info) {
	let params = {};
	try {
		// 优先尝试解析为JSON
		const jsonData = JSON.parse(info);
		params.Prompt = jsonData.prompt || '';
		params.NegativePrompt = jsonData.negative_prompt || '';
		params.Sampler = jsonData.sampler_name || '';
		params.Steps = jsonData.steps;
		params.CfgScale = jsonData.cfg_scale;
		params.Seed = jsonData.seed;
		params.Width = jsonData.width;
		params.Height = jsonData.height;
		params.DenoisingStrength = jsonData.denoising_strength;
		params.Model = jsonData.model_name || jsonData.sd_model_name || '';
		return params;
	} catch (e) {
		// 如果JSON解析失败，则回退到文本解析
		const lines = info.split('\n');
		let negPromptIndex = lines.findIndex(line => line.startsWith('Negative prompt:'));
		params.Prompt = (negPromptIndex > 0 ? lines.slice(0, negPromptIndex) : lines.slice(0, lines.length > 1 ? -1 : 1)).join('\n').trim();
		if (negPromptIndex > -1) {
			params.NegativePrompt = lines[negPromptIndex].replace('Negative prompt:', '').trim();
		}

		const detailsLine = lines[lines.length - 1];
		const details = detailsLine.split(', ').reduce((acc, curr) => {
			const parts = curr.split(': ');
			if (parts.length === 2) acc[parts[0].trim()] = parts[1].trim();
			return acc;
		}, {});

		if(details['Size']) [params.Width, params.Height] = details['Size'].split('x');
		params.Sampler = details['Sampler'];
		params.Steps = details['Steps'];
		params.CfgScale = details['CFG scale'];
		params.Seed = details['Seed'];
		params.DenoisingStrength = details['Denoising strength'];
		params.Model = details['Model'] || details['Model hash'] || '';
		return params;
	}
}