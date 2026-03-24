// 数据关联分析平台 - 前端脚本

// 全局状态
let state = {
    folderPath: '',
    files: [],
    tables: {},
    links: [],
    outputFields: {},
    queryResult: null,
    selectedConfig: null  // 当前加载的配置名
};

// 调试日志
function debugLog(message, type = 'info') {
    const debugContent = document.getElementById('debug-content');
    const time = new Date().toLocaleTimeString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    debugContent.innerHTML += `<p>[${time}] ${prefix} ${message}</p>`;
    debugContent.scrollTop = debugContent.scrollHeight;
    console.log(`[Debug] ${message}`);
}

// API调用（带超时控制）
async function apiCall(url, data, timeoutMs = 300000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const result = await response.json();
        if (!result.success && result.error) {
            throw new Error(result.error);
        }
        return result;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            debugLog('请求超时，请检查文件大小或网络', 'error');
            throw new Error('请求超时');
        }
        debugLog(error.message, 'error');
        throw error;
    }
}

// ==================== 模块一：文件选择 ====================

// 选择文件夹（调用后端tkinter对话框）
async function selectFolder() {
    try {
        const result = await apiCall('/api/select-folder', {});
        
        if (result.success && result.folder_path) {
            // 将选择的路径填入输入框
            document.getElementById('folder-path-input').value = result.folder_path;
            debugLog(`已选择文件夹: ${result.folder_path}`, 'success');
            
            // 自动触发扫描
            refreshFiles();
        } else {
            debugLog('未选择文件夹', 'info');
        }
    } catch (error) {
        debugLog('选择文件夹失败: ' + error.message, 'error');
    }
}

// 目录下拉选择变化处理
function onFolderSelectChange() {
    const select = document.getElementById('folder-select');
    const input = document.getElementById('folder-path-input');
    
    if (select.value === 'custom') {
        input.style.display = 'block';
        input.focus();
    } else if (select.value) {
        input.style.display = 'block';
        input.value = select.value;
        // 自动扫描
        refreshFiles();
    } else {
        input.style.display = 'block';
        input.value = '';
    }
}

// 刷新文件列表（从输入框获取路径）
async function refreshFiles() {
    // 获取输入框的路径
    const inputPath = document.getElementById('folder-path-input').value.trim();
    if (!inputPath) {
        debugLog('请输入文件夹路径', 'error');
        return;
    }
    
    state.folderPath = inputPath;
    document.getElementById('folder-path').textContent = inputPath;
    
    debugLog(`扫描文件夹: ${inputPath}`);
    try {
        const result = await apiCall('/api/scan-folder', {folder_path: inputPath});
        
        if (result.files && result.files.length > 0) {
            state.files = result.files;
            displayFileList(result.files);
            debugLog(`找到 ${result.files.length} 个Excel文件`, 'success');
            
            // 自动勾选
            state.files.forEach((f, i) => {
                const cb = document.getElementById(`file-${i}`);
                if (cb) cb.checked = true;
            });
        } else {
            state.files = [];
            displayFileList([]);
            debugLog('未找到Excel文件', 'error');
        }
        
        // 显示上一级和子目录切换
        if (result.parent_dir || (result.sub_dirs && result.sub_dirs.length > 0)) {
            let navHtml = '<div style="margin-top:10px;padding:8px;background:#f5f5f5;border-radius:4px;">';
            
            // 上一级
            if (result.parent_dir && result.parent_dir !== result.current_dir) {
                navHtml += `<button class="btn-small" onclick="changeFolder('${result.parent_dir}')">⬆ 上一级</button> `;
            }
            
            // 子目录（进入下一级）
            if (result.sub_dirs && result.sub_dirs.length > 0) {
                result.sub_dirs.slice(0, 8).forEach(d => {
                    const newPath = result.current_dir + '/' + d;
                    navHtml += `<button class="btn-small" onclick="changeFolder('${newPath}')">📁 ${d}</button> `;
                });
            }
            
            navHtml += '</div>';
            
            // 添加到文件列表后面
            const container = document.getElementById('file-list');
            const navDiv = document.getElementById('dir-nav');
            if (navDiv) navDiv.remove();
            container.insertAdjacentHTML('afterend', '<div id="dir-nav">' + navHtml + '</div>');
        }
        
        updateTableSelects();
    } catch (error) {
        debugLog(`扫描失败: ${error.message}`, 'error');
    }
}

// 切换目录
function changeFolder(newPath) {
    const select = document.getElementById('folder-select');
    const input = document.getElementById('folder-path-input');
    
    input.value = newPath;
    
    // 尝试在下拉框中找到匹配的目录
    let found = false;
    for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === newPath) {
            select.selectedIndex = i;
            found = true;
            break;
        }
    }
    
    // 如果没找到，设为custom并显示输入框
    if (!found) {
        select.value = 'custom';
        input.style.display = 'block';
    }
    
    refreshFiles();
}

// 显示文件列表
function displayFileList(files) {
    const container = document.getElementById('file-list');
    if (!files || files.length === 0) {
        container.innerHTML = '<p class="hint">未找到Excel文件</p>';
        return;
    }
    
    container.innerHTML = files.map((f, i) => `
        <div class="file-item">
            <input type="checkbox" id="file-${i}" value="${f.path}" checked>
            <label for="file-${i}">${f.name} (${f.size_mb.toFixed(2)} MB)</label>
        </div>
    `).join('');
}

// 扫描所有文件（串行，带超时处理）
async function scanAllFiles() {
    const checkboxes = document.querySelectorAll('#file-list input[type="checkbox"]:checked');
    const files = Array.from(checkboxes).map(cb => cb.value);
    
    if (files.length === 0) {
        debugLog('请先扫描文件夹获取文件列表', 'error');
        return;
    }
    
    debugLog(`开始扫描 ${files.length} 个文件...`);
    
    state.tables = {};
    let successCount = 0;
    let failCount = 0;
    
    // 设置超时
    const timeout = (ms) => new Promise((_, reject) => 
        setTimeout(() => reject(new Error('超时')), ms)
    );
    
    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const fileName = filePath.split('/').pop();
        
        try {
            debugLog(`扫描 ${i+1}/${files.length}: ${fileName}...`);
            
            // 带超时的请求 - 大文件增加超时时间
            const scanResult = await Promise.race([
                apiCall('/api/scan-file', {file_path: filePath}),
                timeout(60000) // 60秒超时，大文件需要更久
            ]);
            
            state.tables[filePath] = {
                filename: scanResult.filename,
                sheets: scanResult.sheets,
                headers: {},
                fields: {}
            };
            
            for (const sheet of scanResult.sheets) {
                try {
                    const headerResult = await Promise.race([
                        apiCall('/api/get-headers', {
                            file_path: filePath,
                            sheet_name: sheet.name,
                            header_rows: 1  // 简化为单行表头，避免复杂处理
                        }),
                        timeout(30000) // 30秒超时
                    ]);
                    
                    state.tables[filePath].headers[sheet.name] = headerResult.headers;
                    state.tables[filePath].fields[sheet.name] = headerResult.fields;
                } catch (he) {
                    debugLog(`⚠️ ${sheet.name} 表头获取失败: ${he.message}`, 'error');
                }
            }
            
            successCount++;
            debugLog(`✅ ${fileName}: 完成`, 'success');
            
        } catch (error) {
            failCount++;
            debugLog(`❌ ${fileName}: ${error.message}`, 'error');
        }
        
        await new Promise(r => setTimeout(r, 100));
    }
    
    debugLog(`扫描完成: 成功 ${successCount}, 失败 ${failCount}`, 'success');
    updateTableSelects();
    displayLinks();
}

// 更新表选择下拉框
function updateTableSelects() {
    const tables = Object.values(state.tables);
    
    const mainSelect = document.getElementById('main-table');
    const linkSelect = document.getElementById('link-table');
    const outputSelect = document.getElementById('output-table');
    
    const mainFirst = '<option value="">-- 选择主表 --</option>';
    const linkFirst = '<option value="">-- 选择关联表 --</option>';
    const outputFirst = '<option value="">-- 选择表 --</option>';
    
    const options = tables.map((t, i) => {
        const path = Object.keys(state.tables)[i];
        return `<option value="${path}">${t.filename}</option>`;
    }).join('');
    
    mainSelect.innerHTML = mainFirst + options;
    linkSelect.innerHTML = linkFirst + options;
    outputSelect.innerHTML = outputFirst + options;
}

// ==================== 模块二：关联配置 ====================

async function loadTableSheets() {
    const mainPath = document.getElementById('main-table').value;
    if (!mainPath) return;
    
    const tableInfo = state.tables[mainPath];
    if (!tableInfo) return;
    
    document.getElementById('link-config-area').style.display = 'block';
    debugLog(`已选择主表: ${tableInfo.filename}`, 'success');
    
    const firstSheet = tableInfo.sheets[0]?.name;
    if (firstSheet) {
        const fields = tableInfo.headers[firstSheet] || [];
        const mainFieldSelect = document.getElementById('main-field');
        mainFieldSelect.innerHTML = fields.map(f => 
            `<option value="${f}">${f}</option>`
        ).join('');
    }
}

async function loadLinkTableSheets() {
    const linkPath = document.getElementById('link-table').value;
    if (!linkPath) return;
    
    const tableInfo = state.tables[linkPath];
    if (!tableInfo) return;
    
    const firstSheet = tableInfo.sheets[0]?.name;
    if (firstSheet) {
        const fields = tableInfo.headers[firstSheet] || [];
        const linkFieldSelect = document.getElementById('link-field');
        linkFieldSelect.innerHTML = fields.map(f => 
            `<option value="${f}">${f}</option>`
        ).join('');
    }
}

function addLink() {
    const mainPath = document.getElementById('main-table').value;
    const linkPath = document.getElementById('link-table').value;
    const mainField = document.getElementById('main-field').value;
    const linkField = document.getElementById('link-field').value;
    const joinType = document.getElementById('join-type')?.value || 'inner';
    
    if (!mainPath || !linkPath || !mainField || !linkField) {
        debugLog('请完整填写关联配置', 'error');
        return;
    }
    
    const mainName = state.tables[mainPath]?.filename || mainPath;
    const linkName = state.tables[linkPath]?.filename || linkPath;
    
    state.links.push({
        left_table: mainPath,
        right_table: linkPath,
        left_field: mainField,
        right_field: linkField,
        join_type: joinType,  // 使用用户选择的join类型
        left_name: mainName,
        right_name: linkName
    });
    
    displayLinks();
    debugLog(`添加关联: ${mainName}.${mainField} = ${linkName}.${linkField}`, 'success');
    
    document.getElementById('link-table').value = '';
    document.getElementById('main-field').innerHTML = '<option value="">-- 主表字段 --</option>';
    document.getElementById('link-field').innerHTML = '<option value="">-- 关联表字段 --</option>';
}

function displayLinks() {
    const container = document.getElementById('link-list');
    
    if (state.links.length === 0) {
        container.innerHTML = '<p class="hint">未配置关联（可单表查询）</p>';
        return;
    }
    
    container.innerHTML = state.links.map((link, i) => `
        <div class="link-tag">
            ${link.left_name || link.left_table}.${link.left_field} = ${link.right_name || link.right_table}.${link.right_field}
            <button onclick="removeLink(${i})">×</button>
        </div>
    `).join('');
}

function removeLink(index) {
    state.links.splice(index, 1);
    displayLinks();
    debugLog(`移除关联 #${index + 1}`, 'info');
}

// ==================== 模块三：输出字段 ====================

async function loadOutputFields() {
    const tablePath = document.getElementById('output-table').value;
    if (!tablePath) return;
    
    const tableInfo = state.tables[tablePath];
    if (!tableInfo) return;
    
    const sheetSelect = document.getElementById('output-sheet');
    sheetSelect.innerHTML = tableInfo.sheets.map(s => 
        `<option value="${s.name}">${s.name}</option>`
    ).join('');
    
    if (tableInfo.sheets.length > 0) {
        loadFieldsForSheet(tablePath, tableInfo.sheets[0].name);
    }
}

function loadFieldsForSheet(filePath, sheetName) {
    const tableInfo = state.tables[filePath];
    const fields = tableInfo.fields[sheetName] || [];
    
    const container = document.getElementById('field-checkboxes');
    
    if (fields.length === 0) {
        container.innerHTML = '<p class="hint">没有字段</p>';
        return;
    }
    
    container.innerHTML = fields.map(f => `
        <div class="field-checkbox-item">
            <input type="checkbox" id="field-${f.name}" value="${f.name}">
            <label for="field-${f.name}">${f.name}</label>
        </div>
    `).join('');
    
    debugLog(`加载 ${tableInfo.filename} - ${sheetName}: ${fields.length} 个字段`, 'success');
}

function addOutputFields() {
    const tablePath = document.getElementById('output-table').value;
    const sheetName = document.getElementById('output-sheet').value;
    
    if (!tablePath || !sheetName) {
        debugLog('请选择表和Sheet', 'error');
        return;
    }
    
    const checkboxes = document.querySelectorAll('#field-checkboxes input[type="checkbox"]:checked');
    const selectedFields = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedFields.length === 0) {
        debugLog('请选择字段', 'error');
        return;
    }
    
    const tableInfo = state.tables[tablePath];
    const tableName = tableInfo.filename;
    
    if (!state.outputFields[tablePath]) {
        state.outputFields[tablePath] = [];
    }
    
    selectedFields.forEach(f => {
        if (!state.outputFields[tablePath].includes(f)) {
            state.outputFields[tablePath].push(f);
        }
    });
    
    checkboxes.forEach(cb => cb.checked = false);
    displayOutputFields();
    debugLog(`添加输出字段: ${tableName} - ${selectedFields.join(', ')}`, 'success');
}

function displayOutputFields() {
    const container = document.getElementById('selected-tags');
    
    const allFields = [];
    for (const [path, fields] of Object.entries(state.outputFields)) {
        const tableInfo = state.tables[path];
        const tableName = tableInfo?.filename || path;
        fields.forEach(f => {
            allFields.push({path, table: tableName, field: f});
        });
    }
    
    if (allFields.length === 0) {
        container.innerHTML = '<p class="hint">未选择输出字段</p>';
        return;
    }
    
    container.innerHTML = allFields.map((item, i) => `
        <span class="field-tag">
            ${item.table}.${item.field}
            <button onclick="removeOutputField('${item.path}', '${item.field}')">×</button>
        </span>
    `).join('');
}

function removeOutputField(path, field) {
    if (state.outputFields[path]) {
        state.outputFields[path] = state.outputFields[path].filter(f => f !== field);
        if (state.outputFields[path].length === 0) {
            delete state.outputFields[path];
        }
    }
    displayOutputFields();
}

// ==================== 模块四：功能操作 ====================

// 简单的配置读取功能
async function loadConfigByName() {
    const configFile = prompt('输入配置文件名（如: test.json, config.json）:');
    if (!configFile) return;
    
    try {
        const result = await apiCall('/api/load-config', {
            config_path: configFile
        });
        
        if (result.success && result.config) {
            const config = result.config;
            
            // 恢复状态
            if (config.tables) state.tables = config.tables;
            if (config.links) state.links = config.links;
            if (config.outputFields) state.outputFields = config.outputFields;
            
            // 刷新界面
            displayTables();
            displayLinks();
            displayOutputFields();
            
            debugLog(`✅ 已加载配置: ${configFile}`, 'success');
        } else {
            debugLog(`❌ 加载失败: ${result.error || '配置文件不存在'}`, 'error');
        }
    } catch (error) {
        debugLog(`❌ 加载失败: ${error.message}`, 'error');
    }
}

// 保存配置
async function doSaveConfig() {
    const configPath = prompt('输入文件名保存配置:', 'my-config.json');
    if (!configPath) return;
    
    try {
        const result = await apiCall('/api/save-config', {
            config: {tables: state.tables, links: state.links, outputFields: state.outputFields},
            output_path: configPath
        });
        
        if (result.success) {
            // 从文件名提取配置名作为selectedConfig
            const configName = configPath.replace('.json', '').replace('config/', '');
            state.selectedConfig = configName;
            debugLog(`✅ 已保存: ${configPath}, selectedConfig=${state.selectedConfig}`, 'success');
            // 刷新配置下拉框并选中最新配置
            initConfigSelect().then(() => {
                const select = document.getElementById('configSelect');
                select.value = configPath;
            });
        } else {
            debugLog(`❌ 保存失败: ${result.error}`, 'error');
        }
    } catch (error) {
        debugLog(`❌ 保存失败: ${error.message}`, 'error');
    }
}

// 页面加载时自动获取配置列表并填充下拉框
async function initConfigSelect() {
    try {
        const result = await apiCall('/api/list-configs', {});
        if (result.success) {
            const select = document.getElementById('configSelect');
            select.innerHTML = '<option value="">-- 选择配置文件 --</option>';
            (result.configs || []).forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                select.appendChild(opt);
            });
        }
    } catch (e) {
        console.error('获取配置列表失败:', e);
    }
}

// 读取选中的配置
async function loadSelectedConfig() {
    const select = document.getElementById('configSelect');
    const configPath = select.value;
    
    if (!configPath) {
        debugLog('⚠️ 请先选择配置文件', 'warning');
        return;
    }
    
    // 检查是否已选择目录
    const folderPath = document.getElementById('folder-path-input').value;
    if (!folderPath) {
        debugLog('⚠️ 请先选择目录', 'warning');
        return;
    }
    
    try {
        const result = await apiCall('/api/load-config', {config_path: configPath});
        
        if (result.success && result.config) {
            const config = result.config;
            state.tables = config.tables || {};
            state.links = config.links || [];
            state.outputFields = config.outputFields || {};
            
            // 校验配置文件中的文件是否在选择的目录下
            const folderFiles = state.files || [];
            let allExist = true;
            const missingFiles = [];
            
            for (const filePath of Object.keys(state.tables)) {
                const fileName = filePath.split('/').pop();
                // 检查文件是否在folderPath目录下
                const fullPath = folderPath + '/' + fileName;
                const exists = folderFiles.some(f => f.path === filePath || f.path === fullPath);
                if (!exists) {
                    allExist = false;
                    missingFiles.push(fileName);
                }
            }
            
            if (allExist) {
                // 文件都存在，显示已加载的表
                const tableList = Object.entries(state.tables).map(([path, info]) => ({
                    path: path,
                    name: info.filename || path.split('/').pop()
                }));
                
                // 手动渲染文件列表（不调用displayFileList因为格式不同）
                const container = document.getElementById('file-list');
                container.innerHTML = tableList.map((f, i) => `
                    <div class="file-item">
                        <input type="checkbox" id="file-${i}" value="${f.path}" checked disabled>
                        <label for="file-${i}">${f.name}</label>
                    </div>
                `).join('');
                
                displayLinks();
                displayOutputFields();
                
                // 设置配置名（从configPath提取，如config/4-config.json → 4-config）
                const configName = configPath.replace('config/', '').replace('.json', '');
                state.selectedConfig = configName;
                
                debugLog(`✅ 配置已加载，文件验证通过，可以执行查询`, 'success');
            } else {
                debugLog(`⚠️ 部分文件不存在: ${missingFiles.join(', ')}`, 'warning');
                debugLog(`⚠️ 请重新扫描目录后再加载配置`, 'warning');
            }
        } else {
            debugLog(`❌ 加载失败: ${result.error}`, 'error');
        }
    } catch (error) {
        debugLog(`❌ 加载失败: ${error.message}`, 'error');
    }
}

// 旧函数保留兼容
async function doLoadConfig() {
    await loadSelectedConfig();
}

async function saveConfig() {
    // 询问是保存还是读取
    const action = prompt('输入 "s" 保存配置，或 "l" 读取配置:', 's');
    
    if (!action) return;
    
    if (action.toLowerCase() === 'l') {
        // 读取配置
        const configPath = prompt('输入配置文件名:', 'test.json');
        if (!configPath) return;
        
        try {
            const result = await apiCall('/api/load-config', {config_path: configPath});
            
            if (result.success && result.config) {
                const config = result.config;
                state.tables = config.tables || {};
                state.links = config.links || [];
                state.outputFields = config.outputFields || {};
                
                displayTables();
                displayLinks();
                displayOutputFields();
                
                debugLog(`✅ 已加载: ${configPath}`, 'success');
            } else {
                debugLog(`❌ 加载失败: ${result.error}`, 'error');
            }
        } catch (error) {
            debugLog(`❌ 加载失败: ${error.message}`, 'error');
        }
        return;
    }
    
    // 保存配置
    const configPath = prompt('配置文件保存路径:', 'my-config.json');
    if (!configPath) return;
    
    try {
        const result = await apiCall('/api/save-config', {
            config: {tables: state.tables, links: state.links, outputFields: state.outputFields},
            output_path: configPath
        });
        
        if (result.success) {
            debugLog(`✅ 配置已保存: ${configPath}`, 'success');
        } else {
            debugLog(`❌ 保存失败: ${result.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        debugLog(`❌ 保存失败: ${error.message}`, 'error');
    }
}

async function saveNamedConfig() {
    const configName = prompt('输入配置名称（如：海淀项目查询）:');
    if (!configName) return;
    
    try {
        const result = await apiCall('/api/save-named-config', {
            config_name: configName,
            tables: state.tables,
            links: state.links,
            output_fields: state.outputFields
        });
        
        debugLog(`saveNamedConfig: result=${JSON.stringify(result)}`, 'info');
        
        if (result.success) {
            state.selectedConfig = configName;
            alert(`配置已保存: ${configName}\n当前selectedConfig: ${state.selectedConfig}`);
            debugLog(`✅ 配置已保存: ${configName}, selectedConfig=${state.selectedConfig}`, 'success');
            // 刷新配置下拉框
            initConfigSelect();
        } else {
            debugLog(`❌ 保存失败: ${JSON.stringify(result)}`, 'error');
        }
    } catch (error) {
        debugLog(`❌ 保存失败: ${error.message}`, 'error');
    }
}

async function loadNamedConfig() {
    // 先获取配置列表
    try {
        const result = await apiCall('/api/load-named-config', {config_name: ''});
        
        if (!result.success) {
            debugLog('❌ 获取配置列表失败', 'error');
            return;
        }
        
        const configs = result.configs || [];
        if (configs.length === 0) {
            alert('暂无保存的配置');
            return;
        }
        
        // 显示配置列表让用户选择
        const configList = configs.map((c, i) => `${i+1}. ${c}`).join('\n');
        const choice = prompt(`选择配置（输入编号）:\n${configList}`);
        
        if (!choice) return;
        
        const idx = parseInt(choice) - 1;
        if (idx < 0 || idx >= configs.length) {
            debugLog('❌ 无效的选择', 'error');
            return;
        }
        
        const selectedConfig = configs[idx];
        debugLog(`加载配置: ${selectedConfig}...`);
        
        // 加载配置
        const loadResult = await apiCall('/api/load-named-config', {config_name: selectedConfig});
        
        if (loadResult.success) {
            // 验证文件
            const validation = loadResult.validation || [];
            const allExist = validation.every(v => v.exists);
            
            if (!allExist) {
                debugLog('⚠️ 部分文件不存在:', 'warning');
                validation.forEach(v => {
                    debugLog(`  ${v.status} ${v.file}`, v.exists ? 'success' : 'error');
                });
            } else {
                debugLog('✅ 所有文件验证通过', 'success');
            }
            
            // 恢复状态
            state.tables = loadResult.config.tables || {};
            state.links = loadResult.config.links || [];
            state.outputFields = loadResult.config.output_fields || {};
            
            // 刷新界面
            displayTables();
            displayLinks();
            displayOutputFields();
            
            // 记录当前配置名
            state.selectedConfig = selectedConfig;
            
            debugLog(`✅ 配置已加载: ${selectedConfig} (${state.tables.length}个表)`, 'success');
        } else {
            debugLog(`❌ 加载失败: ${loadResult.error}`, 'error');
        }
    } catch (error) {
        debugLog(`❌ 加载失败: ${error.message}`, 'error');
    }
}

async function executeQuery() {
    if (Object.keys(state.tables).length === 0) {
        debugLog('请先扫描文件', 'error');
        return;
    }
    
    debugLog('开始执行查询...');
    
    const tables = [];
    for (const [filePath, info] of Object.entries(state.tables)) {
        tables.push({
            name: info.filename,
            file_path: filePath,
            sheet_name: info.sheets[0]?.name || ''
        });
    }
    
    // 生成带时间戳的文件名: query_{配置名}_{时间}.xlsx
    const now = new Date();
    const timestamp = now.getFullYear() + 
        String(now.getMonth()+1).padStart(2,'0') + 
        String(now.getDate()).padStart(2,'0') + '_' + 
        String(now.getHours()).padStart(2,'0') + 
        String(now.getMinutes()).padStart(2,'0') + 
        String(now.getSeconds()).padStart(2,'0');
    const configPrefix = state.selectedConfig || '未保存配置';
    debugLog(`debug: selectedConfig=${state.selectedConfig}, prefix=${configPrefix}`);
    const outputFile = `output/query_${configPrefix}_${timestamp}.xlsx`;
    
    try {
        const result = await apiCall('/api/execute-query', {
            tables: tables,
            links: state.links,
            output_fields: state.outputFields,
            output_file: outputFile
        });
        
        if (result.success) {
            state.queryResult = result;
            displayResult(result);
            debugLog(`查询完成: ${result.rows} 行, ${result.columns} 列`, 'success');
        } else {
            debugLog(`查询失败: ${result.error}`, 'error');
        }
    } catch (error) {
        debugLog(`执行失败: ${error.message}`, 'error');
    }
}

function displayResult(result) {
    const infoDiv = document.getElementById('result-info');
    infoDiv.innerHTML = `✅ 查询成功！

📊 结果: ${result.rows} 行, ${result.columns} 列
📁 输出文件: ${result.output_file}
⏰ 时间: ${new Date().toLocaleString()}`;
    
    document.getElementById('result-actions').style.display = 'flex';
}

function downloadResult() {
    if (!state.queryResult) return;
    alert('文件位置: ' + state.queryResult.output_file);
}

// 生成图表（预留功能）
async function generateChart() {
    alert("图表功能即将推出！");
}

async function generateScript() {
    if (Object.keys(state.tables).length === 0) {
        debugLog('请先扫描文件', 'error');
        return;
    }
    
    const configPrefix = state.selectedConfig || '未保存配置';
    const tables = [];
    for (const [filePath, info] of Object.entries(state.tables)) {
        tables.push({
            name: info.filename,
            file_path: filePath,
            sheet_name: info.sheets[0]?.name || ''
        });
    }
    
    try {
        // 脚本文件名
        const now2 = new Date();
        const timestamp2 = now2.getFullYear() + 
            String(now2.getMonth()+1).padStart(2,'0') + 
            String(now2.getDate()).padStart(2,'0') + '_' + 
            String(now2.getHours()).padStart(2,'0') + 
            String(now2.getMinutes()).padStart(2,'0') + 
            String(now2.getSeconds()).padStart(2,'0');
        const scriptFile = `output/query_${configPrefix}_${timestamp2}.py`;
        
        await apiCall('/api/generate-script', {
            tables: tables,
            links: state.links,
            output_fields: state.outputFields,
            output_file: scriptFile
        });
        debugLog(`脚本已生成: ${scriptFile}`, 'success');
        alert('脚本已生成!');
    } catch (error) {
        debugLog(`生成失败: ${error.message}`, 'error');
    }
}

function generateChart() {
    debugLog('图表功能开发中...', 'info');
    alert('图表功能即将推出！');
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    debugLog('页面已加载，输入文件夹路径开始', 'info');
    
    // 回车键扫描
    document.getElementById('folder-path-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            refreshFiles();
        }
    });
    
    // 初始化配置下拉框
    initConfigSelect();
});