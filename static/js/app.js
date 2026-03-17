// ======================================================
// Hello SQL — Visual SQL Query Builder
// by Anirudh Agarwal
// ======================================================

// ============ State ============
const state = {
    tables: [],
    schema: {},
    columns: {},
    foreignKeys: {},
    mainTable: '',
    distinct: false,
    joins: [],
    conditions: [],
    groupBy: [],
    having: [],
    orderBy: [],
    aggregates: [],
    lastResult: null,
    mode: 'visual', // 'visual' | 'sql'
    sortCol: -1,
    sortDir: 'asc',
    currentPage: 1,
    pageSize: 50,
    history: JSON.parse(localStorage.getItem('hellosql_history') || localStorage.getItem('qf_history') || '[]'),
    aggregateMode: false,
    functionMode: false,
    computedColumns: [],
    setOperation: '',
    setOperationQuery: '',
    windowFunctions: [],
    ctes: [],
    savedQueries: JSON.parse(localStorage.getItem('hellosql_saved_queries') || '[]'),
    dialect: 'sqlite',
    sampleData: {},
    aiGeneratedSQL: '',
};

// Migrate old history key
if (localStorage.getItem('qf_history') && !localStorage.getItem('hellosql_history')) {
    localStorage.setItem('hellosql_history', localStorage.getItem('qf_history'));
    localStorage.removeItem('qf_history');
}

// ============ Constants ============
const STRING_FUNCTIONS = [
    { name: 'UPPER', label: 'UPPER - Uppercase', args: 1 },
    { name: 'LOWER', label: 'LOWER - Lowercase', args: 1 },
    { name: 'LENGTH', label: 'LENGTH - String length', args: 1 },
    { name: 'TRIM', label: 'TRIM - Remove spaces', args: 1 },
    { name: 'SUBSTR', label: 'SUBSTR - Substring', args: 3, extraParams: ['start', 'length'] },
    { name: 'REPLACE', label: 'REPLACE - Replace text', args: 3, extraParams: ['find', 'replace_with'] },
    { name: 'INSTR', label: 'INSTR - Find position', args: 2, extraParams: ['search'] },
];

const DATE_FUNCTIONS = [
    { name: 'DATE', label: 'DATE - Extract date', args: 1 },
    { name: 'TIME', label: 'TIME - Extract time', args: 1 },
    { name: 'DATETIME', label: 'DATETIME - Full datetime', args: 1 },
    { name: 'STRFTIME', label: 'STRFTIME - Format date', args: 2, extraParams: ['format'] },
    { name: 'julianday', label: 'julianday - Julian day', args: 1 },
];

const WINDOW_FUNCS = ['ROW_NUMBER','RANK','DENSE_RANK','NTILE','LAG','LEAD','SUM','AVG','COUNT','MIN','MAX'];

// ============ Init ============
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('dbFileInput').addEventListener('change', handleFileUpload);
    document.getElementById('mainTable').addEventListener('change', handleTableChange);
    document.getElementById('selectAll').addEventListener('change', handleSelectAll);
    document.getElementById('limitValue').addEventListener('input', updateSQL);
    document.getElementById('offsetValue').addEventListener('input', updateSQL);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+Enter: Run query
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            runQuery();
        }
        // Ctrl+S: Save query
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            showSaveQueryDialog();
        }
        // Ctrl+H: History
        if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
            e.preventDefault();
            toggleHistory();
        }
        // Ctrl+I: Schema
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
            e.preventDefault();
            toggleSchema();
        }
        // Escape: close sidebars/modals
        if (e.key === 'Escape') {
            closeSidebars();
            closeSaveModal();
        }
    });

    // Panel resizer
    initResizer();

    // Close export menu on outside click
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('exportMenu');
        const btn = document.getElementById('exportBtn');
        if (menu && menu.style.display !== 'none' && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

    renderHistory();
    renderSavedQueries();
});

// ============ Mode Toggle ============
function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });

    document.getElementById('visualBuilder').style.display = mode === 'visual' ? '' : 'none';
    document.getElementById('sqlEditorPanel').style.display = mode === 'sql' ? '' : 'none';

    if (mode === 'sql') {
        const sql = buildSQL();
        if (sql) document.getElementById('rawSqlInput').value = sql;
    }
}

// ============ Database Upload ============
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('database', file);

    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) { toast(data.error, 'error'); return; }
        setDbLoaded(file.name);
        await loadSchema();
    } catch (err) {
        toast('Failed to upload database', 'error');
    }
}

async function loadSampleDB() {
    try {
        const res = await fetch('/sample_db', { method: 'POST' });
        const data = await res.json();
        if (data.error) { toast(data.error, 'error'); return; }
        setDbLoaded('sample.db');
        await loadSchema();
    } catch (err) {
        toast('Failed to load sample database', 'error');
    }
}

function setDbLoaded(name) {
    document.getElementById('dbStatusText').textContent = name;
    document.getElementById('dbBadge').classList.add('active');
    document.getElementById('statusDb').textContent = name;
    document.getElementById('uploadSection').classList.add('db-loaded');
}

// ============ Schema Loading ============
async function loadSchema() {
    try {
        const res = await fetch('/schema');
        const data = await res.json();
        if (data.error) { toast(data.error, 'error'); return; }

        state.schema = data.schema;
        state.tables = Object.keys(data.schema);

        for (const [table, info] of Object.entries(data.schema)) {
            state.columns[table] = info.columns;
            state.foreignKeys[table] = info.foreign_keys;
        }

        document.getElementById('statusTables').textContent = `${state.tables.length} tables`;

        const sel = document.getElementById('mainTable');
        sel.innerHTML = '<option value="">Select a table...</option>';
        state.tables.forEach(t => {
            const count = state.schema[t].row_count;
            sel.innerHTML += `<option value="${t}">${t} (${count} rows)</option>`;
        });

        document.getElementById('visualBuilder').style.display = '';
        document.getElementById('runBar').style.display = '';

        renderSchemaViewer();
        renderSchemaEditor();
        document.getElementById('schemaEditorSection').style.display = '';
        fetchSampleData();
        toast('Database loaded successfully', 'success');
    } catch (err) {
        toast('Failed to load schema', 'error');
    }
}

// ============ Schema Viewer (Sidebar) ============
function renderSchemaViewer() {
    const body = document.getElementById('schemaBody');
    body.innerHTML = '';

    for (const [table, info] of Object.entries(state.schema)) {
        const div = document.createElement('div');
        div.className = 'schema-table';
        div.innerHTML = `
            <div class="schema-table-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span class="schema-table-name">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                    ${escapeHtml(table)}
                </span>
                <span class="schema-row-count">${info.row_count} rows</span>
            </div>
            <div class="schema-columns">
                ${info.columns.map(c => {
                    const fk = info.foreign_keys.find(f => f.from_column === c.name);
                    return `
                        <div class="schema-col">
                            ${c.pk ? '<span class="col-badge pk">PK</span>' : ''}
                            <span class="schema-col-name">${escapeHtml(c.name)}</span>
                            ${fk ? `<span class="schema-fk-badge">FK → ${fk.to_table}.${fk.to_column}</span>` : ''}
                            <span class="schema-col-type">${c.type || 'ANY'}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        body.appendChild(div);
    }
}

// ============ Schema Editor (Inline) ============
function renderSchemaEditor() {
    const body = document.getElementById('schemaEditorBody');
    body.innerHTML = '';
    const allowedTypes = ['TEXT', 'INTEGER', 'REAL', 'NUMERIC', 'BLOB'];

    for (const [table, info] of Object.entries(state.schema)) {
        const div = document.createElement('div');
        div.className = 'schema-editor-table';
        div.innerHTML = `
            <div class="schema-editor-table-header" onclick="this.parentElement.querySelector('.schema-editor-cols').style.display = this.parentElement.querySelector('.schema-editor-cols').style.display === 'none' ? '' : 'none'">
                <span>${escapeHtml(table)}</span>
                <span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono)">${info.row_count} rows</span>
            </div>
            <div class="schema-editor-cols" style="display:none">
                ${info.columns.map(c => {
                    const fk = info.foreign_keys.find(f => f.from_column === c.name);
                    const currentType = (c.type || 'TEXT').toUpperCase();
                    return `
                        <div class="schema-editor-col">
                            <span class="col-name-ed">${escapeHtml(c.name)}</span>
                            <select onchange="alterColumnType('${escapeHtml(table)}', '${escapeHtml(c.name)}', this.value)">
                                ${allowedTypes.map(t => `<option value="${t}" ${currentType === t ? 'selected' : ''}>${t}</option>`).join('')}
                            </select>
                            <span class="key-badge ${c.pk ? 'pk-active' : ''}" title="${c.pk ? 'Primary Key' : 'Click to set as PK'}"
                                  onclick="toggleKey('${escapeHtml(table)}', '${escapeHtml(c.name)}', 'pk')">PK</span>
                            <span class="key-badge ${fk ? 'fk-active' : ''}" title="${fk ? 'FK → ' + fk.to_table + '.' + fk.to_column : 'Foreign Key'}"
                                  >FK${fk ? ' →' : ''}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        body.appendChild(div);
    }
}

async function alterColumnType(table, column, newType) {
    try {
        const res = await fetch('/alter_column_type', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table, column, new_type: newType })
        });
        const data = await res.json();
        if (data.error) { toast(data.error, 'error'); return; }
        toast(`Changed ${column} type to ${newType}`, 'success');
        await loadSchema();
    } catch (err) {
        toast('Failed to alter column type', 'error');
    }
}

async function toggleKey(table, column, keyType) {
    try {
        const res = await fetch('/set_key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table, column, key_type: keyType })
        });
        const data = await res.json();
        if (data.error) { toast(data.error, 'error'); return; }
        toast(`Updated key for ${column}`, 'success');
        await loadSchema();
    } catch (err) {
        toast('Failed to update key', 'error');
    }
}

// ============ Table Selection ============
async function handleTableChange() {
    const table = document.getElementById('mainTable').value;
    if (!table) {
        hideQuerySections();
        return;
    }

    state.mainTable = table;
    state.joins = [];
    state.conditions = [];
    state.groupBy = [];
    state.having = [];
    state.orderBy = [];
    state.aggregates = [];
    state.aggregateMode = false;
    state.computedColumns = [];
    state.functionMode = false;
    state.windowFunctions = [];

    showQuerySections();
    renderColumnCheckboxes();
    renderJoins();
    renderGroupBy();
    renderOrderBy();
    loadTablePreview(table);
    updateSQL();
}

function showQuerySections() {
    ['selectSection', 'joinSection', 'whereSection', 'groupBySection',
     'havingSection', 'orderBySection', 'limitSection'].forEach(id => {
        document.getElementById(id).style.display = '';
    });
    // Show advanced sections
    document.getElementById('advancedDivider').style.display = '';
    document.getElementById('setOpsSection').style.display = '';
    document.getElementById('windowSection').style.display = '';
    document.getElementById('cteSection').style.display = '';
    document.getElementById('storedProcInfo').style.display = '';
}

function hideQuerySections() {
    ['selectSection', 'joinSection', 'whereSection', 'groupBySection',
     'havingSection', 'orderBySection', 'limitSection'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    document.getElementById('advancedDivider').style.display = 'none';
    document.getElementById('setOpsSection').style.display = 'none';
    document.getElementById('windowSection').style.display = 'none';
    document.getElementById('cteSection').style.display = 'none';
    document.getElementById('storedProcInfo').style.display = 'none';
}

async function loadTablePreview(table) {
    const container = document.getElementById('tablePreview');
    try {
        const res = await fetch(`/preview/${encodeURIComponent(table)}`);
        const data = await res.json();
        if (data.error || !data.rows.length) { container.style.display = 'none'; return; }

        let html = '<table><thead><tr>';
        data.columns.forEach(c => html += `<th>${escapeHtml(c)}</th>`);
        html += '</tr></thead><tbody>';
        data.rows.forEach(row => {
            html += '<tr>';
            row.forEach(v => html += `<td>${v === null ? '<em>NULL</em>' : escapeHtml(String(v))}</td>`);
            html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
        container.style.display = '';
    } catch {
        container.style.display = 'none';
    }
}

// ============ Section Toggle ============
function toggleSection(e) {
    if (e.target.closest('.section-badges') || e.target.closest('.badge-btn') || e.target.closest('.section-count')) {
        return;
    }
    const header = e.currentTarget || e;
    header.parentElement.classList.toggle('section-collapsed');
}

// ============ Column Checkboxes ============
function renderColumnCheckboxes() {
    const container = document.getElementById('columnCheckboxes');
    container.innerHTML = '';
    const selectAllChecked = document.getElementById('selectAll').checked;

    getAllAvailableColumns().forEach(col => {
        const div = document.createElement('label');
        div.className = 'column-item fancy-checkbox';
        div.innerHTML = `
            <input type="checkbox" class="col-cb" data-col="${col.full}" ${selectAllChecked ? '' : 'checked'} onchange="handleColumnCheck()">
            <span class="checkmark"></span>
            <span class="col-name">${escapeHtml(col.full)}</span>
            ${col.pk ? '<span class="col-badge pk">PK</span>' : ''}
            <span class="col-badge type">${col.type || 'ANY'}</span>
        `;
        container.appendChild(div);
    });

    handleSelectAll();
}

function getAllAvailableColumns() {
    const cols = [];
    const hasJoins = state.joins.some(j => j.table);
    const mainCols = state.columns[state.mainTable] || [];

    mainCols.forEach(c => {
        cols.push({
            table: state.mainTable,
            name: c.name,
            full: hasJoins ? `${state.mainTable}.${c.name}` : c.name,
            type: c.type,
            pk: c.pk
        });
    });

    state.joins.forEach(j => {
        if (j.table && state.columns[j.table]) {
            state.columns[j.table].forEach(c => {
                cols.push({
                    table: j.table,
                    name: c.name,
                    full: `${j.table}.${c.name}`,
                    type: c.type,
                    pk: c.pk
                });
            });
        }
    });

    return cols;
}

function escapeSQLString(str) {
    return str.replace(/'/g, "''");
}

function getOrderByOptions() {
    const options = [];
    const allCols = getAllAvailableColumns();

    // When in aggregate mode with GROUP BY, only show GROUP BY columns
    if (state.aggregateMode && state.groupBy.length > 0) {
        const gbItems = allCols
            .filter(c => state.groupBy.includes(c.full))
            .map(c => ({ value: c.full, label: c.full }));
        if (gbItems.length > 0) options.push({ group: 'Columns (GROUP BY)', items: gbItems });
    } else {
        options.push({ group: 'Columns', items: allCols.map(c => ({ value: c.full, label: c.full })) });
    }

    // Aggregate expressions
    if (state.aggregateMode && state.aggregates.length > 0) {
        const aggItems = state.aggregates.map(agg => {
            const expr = `${agg.func}(${agg.column})`;
            const value = agg.alias || expr;
            const label = agg.alias ? `${expr} → ${agg.alias}` : expr;
            return { value, label };
        });
        options.push({ group: 'Aggregates', items: aggItems });
    }

    // Computed columns (functions)
    if (state.functionMode && state.computedColumns.length > 0) {
        const funcItems = state.computedColumns
            .filter(cc => cc.column)
            .map(cc => {
                let expr;
                if (['SUBSTR','REPLACE','STRFTIME','INSTR'].includes(cc.func)) {
                    expr = `${cc.func}(${cc.column}, ...)`;
                } else {
                    expr = `${cc.func}(${cc.column})`;
                }
                const value = cc.alias || expr;
                const label = cc.alias ? `${expr} → ${cc.alias}` : expr;
                return { value, label };
            });
        if (funcItems.length > 0) options.push({ group: 'Functions', items: funcItems });
    }

    // Window functions (alias only)
    if (state.windowFunctions.length > 0) {
        const winItems = state.windowFunctions
            .filter(wf => wf.alias)
            .map(wf => ({ value: wf.alias, label: `${wf.func}(...) → ${wf.alias}` }));
        if (winItems.length > 0) options.push({ group: 'Window Functions', items: winItems });
    }

    return options;
}

function handleSelectAll() {
    const checked = document.getElementById('selectAll').checked;
    document.querySelectorAll('.col-cb').forEach(cb => {
        cb.disabled = checked;
        if (checked) cb.checked = false;
    });
    updateSQL();
}

function handleColumnCheck() {
    const selectAll = document.getElementById('selectAll');
    const checked = document.querySelectorAll('.col-cb:checked');
    if (checked.length === 0) {
        selectAll.checked = true;
        handleSelectAll();
    } else {
        selectAll.checked = false;
    }
    updateSQL();
}

function toggleDistinct() {
    state.distinct = !state.distinct;
    document.getElementById('distinctBadge').classList.toggle('active', state.distinct);
    updateSQL();
}

// ============ Aggregates ============
function toggleAggregateMode() {
    state.aggregateMode = !state.aggregateMode;
    document.getElementById('aggToggleBtn').classList.toggle('active', state.aggregateMode);
    document.getElementById('aggregateSection').style.display = state.aggregateMode ? '' : 'none';
    if (state.aggregateMode && state.aggregates.length === 0) addAggregate();
    updateSQL();
}

function addAggregate() {
    state.aggregates.push({ func: 'COUNT', column: '*', alias: '' });
    renderAggregates();
}

function renderAggregates() {
    const container = document.getElementById('aggregateList');
    container.innerHTML = '';
    const allCols = getAllAvailableColumns();

    state.aggregates.forEach((agg, i) => {
        const div = document.createElement('div');
        div.className = 'aggregate-row';
        div.innerHTML = `
            <select onchange="state.aggregates[${i}].func=this.value; updateSQL()">
                ${['COUNT','SUM','AVG','MIN','MAX'].map(f =>
                    `<option value="${f}" ${agg.func === f ? 'selected' : ''}>${f}</option>`
                ).join('')}
            </select>
            <select onchange="state.aggregates[${i}].column=this.value; updateSQL()">
                <option value="*">*</option>
                ${allCols.map(c => `<option value="${c.full}" ${agg.column === c.full ? 'selected' : ''}>${c.full}</option>`).join('')}
            </select>
            <input type="text" placeholder="alias" value="${escapeHtml(agg.alias)}" style="max-width:70px"
                   onchange="state.aggregates[${i}].alias=this.value; updateSQL()">
            <button class="btn-remove" onclick="state.aggregates.splice(${i},1); renderAggregates(); updateSQL()">×</button>
        `;
        container.appendChild(div);
    });
}

// ============ Functions (String/Date) ============
function toggleFunctionMode() {
    state.functionMode = !state.functionMode;
    document.getElementById('funcToggleBtn').classList.toggle('active', state.functionMode);
    document.getElementById('functionSection').style.display = state.functionMode ? '' : 'none';
    if (state.functionMode && state.computedColumns.length === 0) addComputedColumn();
    updateSQL();
}

function addComputedColumn() {
    state.computedColumns.push({ func: 'UPPER', column: '', alias: '', params: {} });
    renderComputedColumns();
}

function renderComputedColumns() {
    const container = document.getElementById('functionList');
    container.innerHTML = '';
    const allCols = getAllAvailableColumns();

    state.computedColumns.forEach((cc, i) => {
        const allFuncs = [...STRING_FUNCTIONS, ...DATE_FUNCTIONS];
        const funcDef = allFuncs.find(f => f.name === cc.func);
        const div = document.createElement('div');
        div.className = 'aggregate-row';
        div.style.flexWrap = 'wrap';

        let extraInputs = '';
        if (funcDef && funcDef.extraParams) {
            extraInputs = funcDef.extraParams.map(p => {
                const val = cc.params[p] || '';
                return `<input type="text" placeholder="${p}" value="${escapeHtml(val)}" style="max-width:60px"
                        onchange="state.computedColumns[${i}].params['${p}']=this.value; updateSQL()">`;
            }).join('');
        }

        div.innerHTML = `
            <select onchange="state.computedColumns[${i}].func=this.value; renderComputedColumns(); updateSQL()">
                <optgroup label="String">
                    ${STRING_FUNCTIONS.map(f => `<option value="${f.name}" ${cc.func === f.name ? 'selected' : ''}>${f.name}</option>`).join('')}
                </optgroup>
                <optgroup label="Date">
                    ${DATE_FUNCTIONS.map(f => `<option value="${f.name}" ${cc.func === f.name ? 'selected' : ''}>${f.name}</option>`).join('')}
                </optgroup>
            </select>
            <select onchange="state.computedColumns[${i}].column=this.value; updateSQL()">
                <option value="">column</option>
                ${allCols.map(c => `<option value="${c.full}" ${cc.column === c.full ? 'selected' : ''}>${c.full}</option>`).join('')}
            </select>
            ${extraInputs}
            <input type="text" placeholder="alias" value="${escapeHtml(cc.alias)}" style="max-width:60px"
                   onchange="state.computedColumns[${i}].alias=this.value; updateSQL()">
            <button class="btn-remove" onclick="state.computedColumns.splice(${i},1); renderComputedColumns(); updateSQL()">×</button>
        `;
        container.appendChild(div);
    });
}

// ============ JOINs ============
function addJoin() {
    state.joins.push({ type: 'INNER JOIN', table: '', leftCol: '', rightCol: '' });
    renderJoins();
    updateJoinCount();
}

function renderJoins() {
    const container = document.getElementById('joinList');
    container.innerHTML = '';
    const otherTables = state.tables.filter(t => t !== state.mainTable);

    state.joins.forEach((j, i) => {
        const div = document.createElement('div');
        div.className = 'query-row';
        div.innerHTML = `
            <div class="row-label">Join #${i + 1}</div>
            <select onchange="state.joins[${i}].type=this.value; updateSQL()" style="flex:0 0 auto;width:110px">
                ${['INNER JOIN','LEFT JOIN','RIGHT JOIN','CROSS JOIN'].map(t =>
                    `<option value="${t}" ${j.type === t ? 'selected' : ''}>${t}</option>`
                ).join('')}
            </select>
            <select onchange="handleJoinTableChange(${i}, this.value)">
                <option value="">-- table --</option>
                ${otherTables.map(t => `<option value="${t}" ${j.table === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <span class="row-operator">ON</span>
            <select class="join-left-${i}" onchange="state.joins[${i}].leftCol=this.value; updateSQL()">
                <option value="">-- left --</option>
            </select>
            <span class="row-operator">=</span>
            <select class="join-right-${i}" onchange="state.joins[${i}].rightCol=this.value; updateSQL()">
                <option value="">-- right --</option>
            </select>
            <button class="btn-remove" onclick="removeJoin(${i})">×</button>
        `;
        container.appendChild(div);
        populateJoinColumns(i, j);
    });
}

async function handleJoinTableChange(i, tableName) {
    state.joins[i].table = tableName;
    state.joins[i].leftCol = '';
    state.joins[i].rightCol = '';

    if (tableName && !state.columns[tableName]) {
        const res = await fetch(`/columns/${encodeURIComponent(tableName)}`);
        const data = await res.json();
        state.columns[tableName] = data.columns || [];
        const fkRes = await fetch(`/foreign_keys/${encodeURIComponent(tableName)}`);
        const fkData = await fkRes.json();
        state.foreignKeys[tableName] = fkData.foreign_keys || [];
    }

    populateJoinColumns(i, state.joins[i]);
    renderColumnCheckboxes();
    renderGroupBy();
    if (state.aggregateMode) renderAggregates();
    if (state.functionMode) renderComputedColumns();
    updateSQL();
    updateJoinCount();
}

function populateJoinColumns(i, join) {
    const leftSel = document.querySelector(`.join-left-${i}`);
    const rightSel = document.querySelector(`.join-right-${i}`);
    if (!leftSel || !rightSel) return;

    const mainCols = state.columns[state.mainTable] || [];
    leftSel.innerHTML = '<option value="">-- left --</option>';
    mainCols.forEach(c => {
        const val = `${state.mainTable}.${c.name}`;
        leftSel.innerHTML += `<option value="${val}" ${join.leftCol === val ? 'selected' : ''}>${val}</option>`;
    });

    rightSel.innerHTML = '<option value="">-- right --</option>';
    if (join.table && state.columns[join.table]) {
        state.columns[join.table].forEach(c => {
            const val = `${join.table}.${c.name}`;
            rightSel.innerHTML += `<option value="${val}" ${join.rightCol === val ? 'selected' : ''}>${val}</option>`;
        });
    }

    if (join.table && !join.leftCol && !join.rightCol) {
        autoDetectJoinKeys(i, join);
    }
}

function autoDetectJoinKeys(i, join) {
    const mainCols = state.columns[state.mainTable] || [];
    const joinCols = state.columns[join.table] || [];

    for (const fk of (state.foreignKeys[state.mainTable] || [])) {
        if (fk.to_table === join.table) {
            state.joins[i].leftCol = `${state.mainTable}.${fk.from_column}`;
            state.joins[i].rightCol = `${join.table}.${fk.to_column}`;
            renderJoins(); return;
        }
    }
    for (const fk of (state.foreignKeys[join.table] || [])) {
        if (fk.to_table === state.mainTable) {
            state.joins[i].leftCol = `${state.mainTable}.${fk.to_column}`;
            state.joins[i].rightCol = `${join.table}.${fk.from_column}`;
            renderJoins(); return;
        }
    }
    for (const mc of mainCols) {
        for (const jc of joinCols) {
            if (mc.name === 'id' && jc.name === `${state.mainTable}_id`) {
                state.joins[i].leftCol = `${state.mainTable}.${mc.name}`;
                state.joins[i].rightCol = `${join.table}.${jc.name}`;
                renderJoins(); return;
            }
            if (jc.name === 'id' && mc.name === `${join.table}_id`) {
                state.joins[i].leftCol = `${state.mainTable}.${mc.name}`;
                state.joins[i].rightCol = `${join.table}.${jc.name}`;
                renderJoins(); return;
            }
        }
    }
}

function removeJoin(i) {
    state.joins.splice(i, 1);
    renderJoins();
    renderColumnCheckboxes();
    renderGroupBy();
    if (state.aggregateMode) renderAggregates();
    if (state.functionMode) renderComputedColumns();
    updateSQL();
    updateJoinCount();
}

function updateJoinCount() {
    const count = state.joins.filter(j => j.table).length;
    const badge = document.getElementById('joinCount');
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
}

// ============ WHERE ============
function addCondition() {
    state.conditions.push({ column: '', operator: '=', value: '', logic: 'AND' });
    renderConditions();
    updateWhereCount();
}

function renderConditions() {
    const container = document.getElementById('whereList');
    container.innerHTML = '';
    const allCols = getAllAvailableColumns();

    state.conditions.forEach((cond, i) => {
        const div = document.createElement('div');
        div.className = 'query-row';
        const needsValue = !['IS NULL', 'IS NOT NULL'].includes(cond.operator);
        const placeholder = cond.operator === 'BETWEEN' ? 'val1 AND val2' :
                           ['IN', 'NOT IN'].includes(cond.operator) ? '1, 2, 3' : 'value';

        div.innerHTML = `
            ${i > 0 ? `<select onchange="state.conditions[${i}].logic=this.value; updateSQL()" style="flex:0 0 auto;width:65px">
                <option value="AND" ${cond.logic === 'AND' ? 'selected' : ''}>AND</option>
                <option value="OR" ${cond.logic === 'OR' ? 'selected' : ''}>OR</option>
            </select>` : ''}
            <select onchange="state.conditions[${i}].column=this.value; updateSQL()">
                <option value="">column</option>
                ${allCols.map(c => `<option value="${c.full}" ${cond.column === c.full ? 'selected' : ''}>${c.full}</option>`).join('')}
            </select>
            <select onchange="state.conditions[${i}].operator=this.value; renderConditions(); updateSQL()" style="flex:0 0 auto;width:90px">
                ${['=','!=','>','<','>=','<=','LIKE','NOT LIKE','IN','NOT IN','IS NULL','IS NOT NULL','BETWEEN'].map(op =>
                    `<option value="${op}" ${cond.operator === op ? 'selected' : ''}>${op}</option>`
                ).join('')}
            </select>
            ${needsValue ? `<input type="text" placeholder="${placeholder}" value="${escapeHtml(cond.value)}"
                   onchange="state.conditions[${i}].value=this.value; updateSQL()">` : ''}
            <button class="btn-remove" onclick="state.conditions.splice(${i},1); renderConditions(); updateSQL(); updateWhereCount()">×</button>
        `;
        container.appendChild(div);
    });
}

function updateWhereCount() {
    const count = state.conditions.filter(c => c.column).length;
    const badge = document.getElementById('whereCount');
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
}

// ============ GROUP BY ============
function renderGroupBy() {
    const container = document.getElementById('groupByList');
    container.innerHTML = '';

    getAllAvailableColumns().forEach(col => {
        const chip = document.createElement('span');
        chip.className = 'chip' + (state.groupBy.includes(col.full) ? ' active' : '');
        chip.textContent = col.full;
        chip.onclick = () => {
            const idx = state.groupBy.indexOf(col.full);
            if (idx >= 0) state.groupBy.splice(idx, 1);
            else state.groupBy.push(col.full);
            renderGroupBy();
            updateSQL();
        };
        container.appendChild(chip);
    });
}

// ============ HAVING ============
function addHaving() {
    state.having.push({ func: 'COUNT', column: '*', operator: '>', value: '', logic: 'AND' });
    renderHaving();
}

function renderHaving() {
    const container = document.getElementById('havingList');
    container.innerHTML = '';
    const allCols = getAllAvailableColumns();

    state.having.forEach((h, i) => {
        const div = document.createElement('div');
        div.className = 'query-row';
        div.innerHTML = `
            ${i > 0 ? `<select onchange="state.having[${i}].logic=this.value; updateSQL()" style="flex:0 0 auto;width:65px">
                <option value="AND" ${h.logic === 'AND' ? 'selected' : ''}>AND</option>
                <option value="OR" ${h.logic === 'OR' ? 'selected' : ''}>OR</option>
            </select>` : ''}
            <select onchange="state.having[${i}].func=this.value; updateSQL()" style="flex:0 0 auto;width:75px">
                ${['COUNT','SUM','AVG','MIN','MAX'].map(f => `<option value="${f}" ${h.func === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <select onchange="state.having[${i}].column=this.value; updateSQL()">
                <option value="*">*</option>
                ${allCols.map(c => `<option value="${c.full}" ${h.column === c.full ? 'selected' : ''}>${c.full}</option>`).join('')}
            </select>
            <select onchange="state.having[${i}].operator=this.value; updateSQL()" style="flex:0 0 auto;width:60px">
                ${['=','!=','>','<','>=','<='].map(op => `<option value="${op}" ${h.operator === op ? 'selected' : ''}>${op}</option>`).join('')}
            </select>
            <input type="text" placeholder="value" value="${escapeHtml(h.value)}"
                   onchange="state.having[${i}].value=this.value; updateSQL()">
            <button class="btn-remove" onclick="state.having.splice(${i},1); renderHaving(); updateSQL()">×</button>
        `;
        container.appendChild(div);
    });
}

// ============ ORDER BY ============
function addOrderBy() {
    state.orderBy.push({ column: '', direction: 'ASC' });
    renderOrderBy();
}

function renderOrderBy() {
    const container = document.getElementById('orderByList');
    container.innerHTML = '';
    const optionGroups = getOrderByOptions();

    state.orderBy.forEach((ob, i) => {
        const div = document.createElement('div');
        div.className = 'query-row';

        let optionsHtml = '<option value="">column</option>';
        optionGroups.forEach(group => {
            if (group.items.length === 0) return;
            optionsHtml += `<optgroup label="${escapeHtml(group.group)}">`;
            group.items.forEach(item => {
                optionsHtml += `<option value="${escapeHtml(item.value)}" ${ob.column === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`;
            });
            optionsHtml += '</optgroup>';
        });

        div.innerHTML = `
            <select onchange="state.orderBy[${i}].column=this.value; updateSQL()">
                ${optionsHtml}
            </select>
            <select onchange="state.orderBy[${i}].direction=this.value; updateSQL()" style="flex:0 0 auto;width:75px">
                <option value="ASC" ${ob.direction === 'ASC' ? 'selected' : ''}>ASC ↑</option>
                <option value="DESC" ${ob.direction === 'DESC' ? 'selected' : ''}>DESC ↓</option>
            </select>
            <button class="btn-remove" onclick="state.orderBy.splice(${i},1); renderOrderBy(); updateSQL()">×</button>
        `;
        container.appendChild(div);
    });
}

// ============ Set Operations ============
function handleSetOpsChange() {
    state.setOperation = document.getElementById('setOpsType').value;
    document.getElementById('setOpsQueryWrap').style.display = state.setOperation ? '' : 'none';
    updateSQL();
}

// ============ Window Functions ============
function addWindowFunction() {
    state.windowFunctions.push({ func: 'ROW_NUMBER', column: '', alias: '', partitionBy: '', orderByCol: '', orderByDir: 'ASC', n: 4, offset: 1, defaultVal: '' });
    renderWindowFunctions();
}

function renderWindowFunctions() {
    const container = document.getElementById('windowList');
    container.innerHTML = '';
    const allCols = getAllAvailableColumns();

    state.windowFunctions.forEach((wf, i) => {
        const needsCol = !['ROW_NUMBER', 'RANK', 'DENSE_RANK'].includes(wf.func);
        const needsN = wf.func === 'NTILE';
        const needsOffset = ['LAG', 'LEAD'].includes(wf.func);

        const div = document.createElement('div');
        div.className = 'window-row';
        div.innerHTML = `
            <div class="window-row-top">
                <select onchange="state.windowFunctions[${i}].func=this.value; renderWindowFunctions(); updateSQL()">
                    ${WINDOW_FUNCS.map(f => `<option value="${f}" ${wf.func === f ? 'selected' : ''}>${f}</option>`).join('')}
                </select>
                ${needsCol ? `<select onchange="state.windowFunctions[${i}].column=this.value; updateSQL()">
                    <option value="">column</option>
                    <option value="*" ${wf.column === '*' ? 'selected' : ''}>*</option>
                    ${allCols.map(c => `<option value="${c.full}" ${wf.column === c.full ? 'selected' : ''}>${c.full}</option>`).join('')}
                </select>` : ''}
                ${needsN ? `<input type="number" placeholder="N" value="${wf.n}" style="max-width:50px"
                    onchange="state.windowFunctions[${i}].n=this.value; updateSQL()">` : ''}
                ${needsOffset ? `<input type="number" placeholder="offset" value="${wf.offset}" style="max-width:55px"
                    onchange="state.windowFunctions[${i}].offset=this.value; updateSQL()">` : ''}
                <input type="text" placeholder="alias" value="${escapeHtml(wf.alias)}" style="max-width:70px"
                    onchange="state.windowFunctions[${i}].alias=this.value; updateSQL()">
                <button class="btn-remove" onclick="state.windowFunctions.splice(${i},1); renderWindowFunctions(); updateSQL()">×</button>
            </div>
            <div class="window-row-bottom">
                <span class="row-label" style="width:auto;flex-shrink:0">PARTITION BY</span>
                <select onchange="state.windowFunctions[${i}].partitionBy=this.value; updateSQL()">
                    <option value="">-- none --</option>
                    ${allCols.map(c => `<option value="${c.full}" ${wf.partitionBy === c.full ? 'selected' : ''}>${c.full}</option>`).join('')}
                </select>
                <span class="row-label" style="width:auto;flex-shrink:0">ORDER BY</span>
                <select onchange="state.windowFunctions[${i}].orderByCol=this.value; updateSQL()">
                    <option value="">-- none --</option>
                    ${allCols.map(c => `<option value="${c.full}" ${wf.orderByCol === c.full ? 'selected' : ''}>${c.full}</option>`).join('')}
                </select>
                <select onchange="state.windowFunctions[${i}].orderByDir=this.value; updateSQL()" style="flex:0 0 auto;width:65px">
                    <option value="ASC" ${wf.orderByDir === 'ASC' ? 'selected' : ''}>ASC</option>
                    <option value="DESC" ${wf.orderByDir === 'DESC' ? 'selected' : ''}>DESC</option>
                </select>
            </div>
        `;
        container.appendChild(div);
    });
}

// ============ CTEs ============
function addCTE() {
    state.ctes.push({ name: '', query: '' });
    renderCTEs();
}

function renderCTEs() {
    const container = document.getElementById('cteList');
    container.innerHTML = '';

    state.ctes.forEach((cte, i) => {
        const div = document.createElement('div');
        div.className = 'cte-row';
        div.innerHTML = `
            <div class="cte-row-header">
                <input type="text" placeholder="cte_name" value="${escapeHtml(cte.name)}"
                       onchange="state.ctes[${i}].name=this.value; updateSQL()">
                <span style="color:var(--text-muted);font-size:11px">AS</span>
                <button class="btn-remove" onclick="state.ctes.splice(${i},1); renderCTEs(); updateSQL()">×</button>
            </div>
            <textarea placeholder="SELECT ... FROM ..." spellcheck="false"
                      onchange="state.ctes[${i}].query=this.value; updateSQL()"
                      oninput="state.ctes[${i}].query=this.value; updateSQL()">${escapeHtml(cte.query)}</textarea>
        `;
        container.appendChild(div);
    });
}

// ============ SQL Generation ============
function buildSQL() {
    if (!state.mainTable) return '';

    let sql = 'SELECT ';
    if (state.distinct) sql += 'DISTINCT ';

    const selectAll = document.getElementById('selectAll').checked;
    const checkedCols = [...document.querySelectorAll('.col-cb:checked')].map(cb => cb.dataset.col);
    const aggParts = [];

    if (state.aggregateMode && state.aggregates.length > 0) {
        state.aggregates.forEach(agg => {
            let part = `${agg.func}(${agg.column})`;
            if (agg.alias) {
                const safeAlias = agg.alias.includes(' ') ? `"${agg.alias}"` : agg.alias;
                part += ` AS ${safeAlias}`;
            }
            aggParts.push(part);
        });
    }

    // Computed columns (functions)
    const funcParts = [];
    if (state.functionMode && state.computedColumns.length > 0) {
        state.computedColumns.forEach(cc => {
            if (!cc.column) return;
            let expr;
            if (cc.func === 'SUBSTR') {
                expr = `SUBSTR(${cc.column}, ${cc.params.start || 1}, ${cc.params.length || 10})`;
            } else if (cc.func === 'REPLACE') {
                expr = `REPLACE(${cc.column}, '${escapeSQLString(cc.params.find || '')}', '${escapeSQLString(cc.params.replace_with || '')}')`;
            } else if (cc.func === 'STRFTIME') {
                expr = `STRFTIME('${escapeSQLString(cc.params.format || '%Y-%m-%d')}', ${cc.column})`;
            } else if (cc.func === 'INSTR') {
                expr = `INSTR(${cc.column}, '${escapeSQLString(cc.params.search || '')}')`;
            } else {
                expr = `${cc.func}(${cc.column})`;
            }
            if (cc.alias) {
                const safeAlias = cc.alias.includes(' ') ? `"${cc.alias}"` : cc.alias;
                expr += ` AS ${safeAlias}`;
            }
            funcParts.push(expr);
        });
    }

    // Window function parts
    const winParts = [];
    if (state.windowFunctions.length > 0) {
        state.windowFunctions.forEach(wf => {
            let funcPart;
            if (['ROW_NUMBER', 'RANK', 'DENSE_RANK'].includes(wf.func)) {
                funcPart = `${wf.func}()`;
            } else if (wf.func === 'NTILE') {
                funcPart = `NTILE(${wf.n || 4})`;
            } else if (['LAG', 'LEAD'].includes(wf.func)) {
                funcPart = `${wf.func}(${wf.column || '*'}${wf.offset ? ', ' + wf.offset : ''}${wf.defaultVal ? ", '" + wf.defaultVal + "'" : ''})`;
            } else {
                funcPart = `${wf.func}(${wf.column || '*'})`;
            }

            let overClause = 'OVER (';
            const overParts = [];
            if (wf.partitionBy) overParts.push(`PARTITION BY ${wf.partitionBy}`);
            if (wf.orderByCol) overParts.push(`ORDER BY ${wf.orderByCol} ${wf.orderByDir}`);
            overClause += overParts.join(' ') + ')';

            let expr = `${funcPart} ${overClause}`;
            if (wf.alias) {
                const safeAlias = wf.alias.includes(' ') ? `"${wf.alias}"` : wf.alias;
                expr += ` AS ${safeAlias}`;
            }
            winParts.push(expr);
        });
    }

    if (selectAll && aggParts.length === 0 && funcParts.length === 0 && winParts.length === 0) {
        sql += '*';
    } else {
        const parts = [];
        if (!selectAll) parts.push(...checkedCols);
        if (state.groupBy.length > 0 && aggParts.length > 0) {
            state.groupBy.forEach(gb => {
                if (!parts.includes(gb)) parts.unshift(gb);
            });
        }
        parts.push(...aggParts);
        parts.push(...funcParts);
        parts.push(...winParts);
        sql += parts.length > 0 ? parts.join(', ') : '*';
    }

    sql += `\nFROM ${state.mainTable}`;

    // JOINs
    state.joins.forEach(j => {
        if (j.table) {
            sql += `\n${j.type} ${j.table}`;
            if (j.leftCol && j.rightCol) sql += ` ON ${j.leftCol} = ${j.rightCol}`;
        }
    });

    // WHERE
    const validConds = state.conditions.filter(c => c.column);
    if (validConds.length > 0) {
        sql += '\nWHERE ';
        validConds.forEach((c, i) => {
            if (i > 0) sql += ` ${c.logic} `;
            sql += c.column;
            if (['IS NULL', 'IS NOT NULL'].includes(c.operator)) {
                sql += ` ${c.operator}`;
            } else if (['IN', 'NOT IN'].includes(c.operator)) {
                sql += ` ${c.operator} (${c.value})`;
            } else if (c.operator === 'BETWEEN') {
                sql += ` BETWEEN ${c.value}`;
            } else if (['LIKE', 'NOT LIKE'].includes(c.operator)) {
                sql += ` ${c.operator} '${c.value}'`;
            } else {
                const num = Number(c.value);
                if (!isNaN(num) && c.value.trim() !== '') {
                    sql += ` ${c.operator} ${c.value}`;
                } else {
                    sql += ` ${c.operator} '${c.value}'`;
                }
            }
        });
    }

    // GROUP BY
    if (state.groupBy.length > 0) {
        sql += `\nGROUP BY ${state.groupBy.join(', ')}`;
    }

    // HAVING
    const validHaving = state.having.filter(h => h.value);
    if (validHaving.length > 0) {
        sql += '\nHAVING ';
        validHaving.forEach((h, i) => {
            if (i > 0) sql += ` ${h.logic} `;
            sql += `${h.func}(${h.column}) ${h.operator} ${h.value}`;
        });
    }

    // ORDER BY
    const validOrder = state.orderBy.filter(o => o.column);
    if (validOrder.length > 0) {
        sql += `\nORDER BY ${validOrder.map(o => `${o.column} ${o.direction}`).join(', ')}`;
    }

    // LIMIT / OFFSET
    const limitNum = parseInt(document.getElementById('limitValue').value);
    const offsetNum = parseInt(document.getElementById('offsetValue').value);
    if (!isNaN(limitNum) && limitNum >= 0) {
        sql += `\nLIMIT ${limitNum}`;
        if (!isNaN(offsetNum) && offsetNum > 0) sql += ` OFFSET ${offsetNum}`;
    }

    // Set Operations
    const setOpsQuery = document.getElementById('setOpsQuery') ? document.getElementById('setOpsQuery').value.trim() : '';
    if (state.setOperation && setOpsQuery) {
        sql = `${sql}\n${state.setOperation}\n${setOpsQuery}`;
    }

    // CTEs
    const validCTEs = state.ctes.filter(c => c.name && c.query.trim());
    if (validCTEs.length > 0) {
        const cteParts = validCTEs.map(c => `${c.name} AS (\n${c.query.trim()}\n)`);
        sql = `WITH ${cteParts.join(',\n')}\n${sql}`;
    }

    return sql;
}

// ============ SQL Parser (reverse: SQL text → visual builder state) ============

function extractBalancedParens(str) {
    let depth = 1, i = 0;
    while (i < str.length && depth > 0) {
        if (str[i] === '(') depth++;
        else if (str[i] === ')') depth--;
        if (depth > 0) i++;
    }
    return str.slice(0, i);
}

function splitTopLevel(str, delimiter) {
    const parts = [];
    let depth = 0, current = '', inSingle = false, inDouble = false;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (!inSingle && !inDouble) {
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
        }
        if (ch === delimiter && depth === 0 && !inSingle && !inDouble) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current);
    return parts;
}

function findTopLevelKeyword(sql, keyword) {
    let depth = 0, inSingle = false, inDouble = false;
    const upper = sql.toUpperCase();
    const kw = keyword.toUpperCase();
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (!inSingle && !inDouble) {
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
        }
        if (depth === 0 && !inSingle && !inDouble && upper.slice(i, i + kw.length) === kw) {
            const before = i === 0 || /[\s\n]/.test(sql[i - 1]);
            const after = i + kw.length >= sql.length || /[\s\n]/.test(sql[i + kw.length]);
            if (before && after) return i;
        }
    }
    return -1;
}

function splitWhereTokens(whereStr) {
    const results = [];
    let current = '', depth = 0, inSingle = false, inDouble = false;
    let nextLogic = 'AND';
    for (let i = 0; i < whereStr.length; i++) {
        const ch = whereStr[i];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (!inSingle && !inDouble) {
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
        }
        if (depth === 0 && !inSingle && !inDouble) {
            const rest = whereStr.slice(i).toUpperCase();
            const andMatch = rest.match(/^\s+AND\s/);
            if (andMatch) {
                if (current.trim()) results.push({ logic: nextLogic, expr: current.trim() });
                nextLogic = 'AND';
                current = '';
                i += andMatch[0].length - 1;
                continue;
            }
            const orMatch = rest.match(/^\s+OR\s/);
            if (orMatch) {
                if (current.trim()) results.push({ logic: nextLogic, expr: current.trim() });
                nextLogic = 'OR';
                current = '';
                i += orMatch[0].length - 1;
                continue;
            }
        }
        current += ch;
    }
    if (current.trim()) results.push({ logic: nextLogic, expr: current.trim() });
    return results;
}

function parseSelectClause(str, snapshot) {
    str = str.replace(/^\s*SELECT\s+/i, '');
    if (/^DISTINCT\s+/i.test(str)) {
        snapshot.distinct = true;
        str = str.replace(/^DISTINCT\s+/i, '');
    }
    if (str.trim() === '*') { snapshot.selectAll = true; return; }

    snapshot.selectAll = false;
    const items = splitTopLevel(str, ',');
    const AGG_FUNCS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
    const STR_DATE_FUNCS = ['UPPER', 'LOWER', 'LENGTH', 'TRIM', 'SUBSTR', 'REPLACE', 'INSTR', 'DATE', 'TIME', 'DATETIME', 'STRFTIME'];

    for (const item of items) {
        const t = item.trim();

        // Window function: FUNC(...) OVER (...) [AS alias]
        const winMatch = t.match(/^(\w+)\(([^)]*)\)\s+OVER\s*\(([^)]*)\)(?:\s+AS\s+("?[^"]+?"?|\w+))?$/i);
        if (winMatch) {
            snapshot.windowFunctions.push(parseWindowFunctionExpr(winMatch));
            continue;
        }

        // Aggregate: FUNC(col) [AS alias]
        const aggMatch = t.match(/^(COUNT|SUM|AVG|MIN|MAX)\(([^)]*)\)(?:\s+AS\s+("?[^"]+?"?|\w+))?$/i);
        if (aggMatch && AGG_FUNCS.includes(aggMatch[1].toUpperCase())) {
            snapshot.aggregates.push({
                func: aggMatch[1].toUpperCase(),
                column: aggMatch[2].trim(),
                alias: (aggMatch[3] || '').replace(/"/g, '')
            });
            snapshot.aggregateMode = true;
            continue;
        }

        // String/Date function: FUNC(...) [AS alias]
        const funcMatch = t.match(/^(\w+)\((.+)\)(?:\s+AS\s+("?[^"]+?"?|\w+))?$/i);
        if (funcMatch && STR_DATE_FUNCS.includes(funcMatch[1].toUpperCase())) {
            snapshot.computedColumns.push(parseComputedColumnExpr(funcMatch[1].toUpperCase(), funcMatch[2], funcMatch[3]));
            snapshot.functionMode = true;
            continue;
        }

        // Plain column (possibly with alias — strip it)
        const aliasMatch = t.match(/^(.+?)\s+AS\s+.+$/i);
        snapshot.selectedColumns.push(aliasMatch ? aliasMatch[1].trim() : t);
    }
}

function parseWindowFunctionExpr(match) {
    const func = match[1].toUpperCase();
    const args = match[2].trim();
    const overClause = match[3].trim();
    const alias = (match[4] || '').replace(/"/g, '');
    const wf = { func, column: '', alias, partitionBy: '', orderByCol: '', orderByDir: 'ASC', n: '', offset: '', defaultVal: '' };

    if (['LAG', 'LEAD'].includes(func)) {
        const parts = args.split(',').map(s => s.trim());
        wf.column = parts[0] || '*';
        if (parts[1]) wf.offset = parts[1];
        if (parts[2]) wf.defaultVal = parts[2].replace(/'/g, '');
    } else if (func === 'NTILE') {
        wf.n = args || '4';
    } else if (!['ROW_NUMBER', 'RANK', 'DENSE_RANK'].includes(func)) {
        wf.column = args || '*';
    }

    const partMatch = overClause.match(/PARTITION\s+BY\s+(\S+)/i);
    if (partMatch) wf.partitionBy = partMatch[1];
    const orderMatch = overClause.match(/ORDER\s+BY\s+(\S+)\s*(ASC|DESC)?/i);
    if (orderMatch) {
        wf.orderByCol = orderMatch[1];
        wf.orderByDir = (orderMatch[2] || 'ASC').toUpperCase();
    }
    return wf;
}

function parseComputedColumnExpr(fname, argsStr, aliasStr) {
    const alias = (aliasStr || '').replace(/"/g, '').trim();
    const cc = { func: fname, column: '', alias, params: {} };

    if (fname === 'SUBSTR') {
        const parts = argsStr.split(',').map(s => s.trim());
        cc.column = parts[0]; cc.params.start = parts[1] || '1'; cc.params.length = parts[2] || '10';
    } else if (fname === 'REPLACE') {
        const parts = splitTopLevel(argsStr, ',').map(s => s.trim());
        cc.column = parts[0];
        cc.params.find = (parts[1] || '').replace(/^'|'$/g, '');
        cc.params.replace_with = (parts[2] || '').replace(/^'|'$/g, '');
    } else if (fname === 'STRFTIME') {
        const parts = splitTopLevel(argsStr, ',').map(s => s.trim());
        cc.params.format = (parts[0] || '').replace(/^'|'$/g, '');
        cc.column = parts[1] || '';
    } else if (fname === 'INSTR') {
        const parts = splitTopLevel(argsStr, ',').map(s => s.trim());
        cc.column = parts[0];
        cc.params.search = (parts[1] || '').replace(/^'|'$/g, '');
    } else {
        cc.column = argsStr.trim();
    }
    return cc;
}

function parseFromAndJoins(fromStr, snapshot) {
    const joinPattern = /\b(INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|CROSS\s+JOIN|JOIN)\b/gi;
    const joinTypes = [];
    const segments = [];
    let lastIdx = 0, m;

    while ((m = joinPattern.exec(fromStr)) !== null) {
        segments.push(fromStr.slice(lastIdx, m.index).trim());
        let jt = m[1].toUpperCase().replace(/\s+/g, ' ');
        if (jt === 'JOIN') jt = 'INNER JOIN';
        joinTypes.push(jt);
        lastIdx = m.index + m[1].length;
    }
    segments.push(fromStr.slice(lastIdx).trim());

    // Main table — strip alias (e.g. "employees e" → "employees")
    let mainTable = segments[0].trim();
    const mainParts = mainTable.split(/\s+/);
    if (mainParts.length > 1 && state.tables.includes(mainParts[0])) {
        mainTable = mainParts[0];
    }
    snapshot.mainTable = mainTable;

    // Joins
    for (let i = 1; i < segments.length; i++) {
        const joinStr = segments[i].trim();
        const onMatch = joinStr.match(/^(\S+)(?:\s+\w+)?\s+ON\s+(\S+)\s*=\s*(\S+)$/i);
        if (onMatch) {
            let joinTable = onMatch[1];
            if (!state.tables.includes(joinTable)) {
                const jp = joinTable.split(/\s+/);
                if (state.tables.includes(jp[0])) joinTable = jp[0];
            }
            snapshot.joins.push({ type: joinTypes[i - 1], table: joinTable, leftCol: onMatch[2], rightCol: onMatch[3] });
        } else {
            const tbl = joinStr.split(/\s/)[0];
            snapshot.joins.push({ type: joinTypes[i - 1], table: tbl, leftCol: '', rightCol: '' });
        }
    }
}

function parseWhereClause(whereStr, snapshot) {
    const tokens = splitWhereTokens(whereStr);
    for (const token of tokens) {
        const expr = token.expr.trim();
        const cond = { column: '', operator: '=', value: '', logic: token.logic };

        // IS NULL / IS NOT NULL
        const nullMatch = expr.match(/^(\S+)\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i);
        if (nullMatch) {
            cond.column = nullMatch[1];
            cond.operator = nullMatch[2].toUpperCase().replace(/\s+/g, ' ');
            snapshot.conditions.push(cond); continue;
        }
        // IN / NOT IN
        const inMatch = expr.match(/^(\S+)\s+(NOT\s+IN|IN)\s*\((.+)\)$/i);
        if (inMatch) {
            cond.column = inMatch[1];
            cond.operator = inMatch[2].toUpperCase().replace(/\s+/g, ' ');
            cond.value = inMatch[3].trim();
            snapshot.conditions.push(cond); continue;
        }
        // BETWEEN
        const betweenMatch = expr.match(/^(\S+)\s+BETWEEN\s+(.+)$/i);
        if (betweenMatch) {
            cond.column = betweenMatch[1]; cond.operator = 'BETWEEN'; cond.value = betweenMatch[2].trim();
            snapshot.conditions.push(cond); continue;
        }
        // LIKE / NOT LIKE
        const likeMatch = expr.match(/^(\S+)\s+(NOT\s+LIKE|LIKE)\s+'([^']*)'$/i);
        if (likeMatch) {
            cond.column = likeMatch[1];
            cond.operator = likeMatch[2].toUpperCase().replace(/\s+/g, ' ');
            cond.value = likeMatch[3];
            snapshot.conditions.push(cond); continue;
        }
        // Standard comparison: col OP value
        const compMatch = expr.match(/^(\S+)\s*(!=|<>|>=|<=|=|>|<)\s*(.+)$/);
        if (compMatch) {
            cond.column = compMatch[1];
            cond.operator = compMatch[2] === '<>' ? '!=' : compMatch[2];
            cond.value = compMatch[3].trim().replace(/^'|'$/g, '');
            snapshot.conditions.push(cond); continue;
        }
    }
}

function parseHavingClause(havingStr, snapshot) {
    const tokens = splitWhereTokens(havingStr);
    for (const token of tokens) {
        const m = token.expr.match(/^(COUNT|SUM|AVG|MIN|MAX)\(([^)]*)\)\s*(!=|<>|>=|<=|=|>|<)\s*(.+)$/i);
        if (m) {
            snapshot.having.push({
                func: m[1].toUpperCase(), column: m[2].trim(),
                operator: m[3] === '<>' ? '!=' : m[3], value: m[4].trim(), logic: token.logic
            });
        }
    }
}

function parseOrderByClause(orderByStr, snapshot) {
    const parts = splitTopLevel(orderByStr, ',');
    for (const part of parts) {
        const m = part.trim().match(/^(.+?)\s+(ASC|DESC)$/i);
        if (m) {
            snapshot.orderBy.push({ column: m[1].trim(), direction: m[2].toUpperCase() });
        } else {
            snapshot.orderBy.push({ column: part.trim(), direction: 'ASC' });
        }
    }
}

function parseSQL(sql) {
    let remaining = sql.trim();
    const snapshot = {
        mainTable: '', distinct: false, joins: [], conditions: [], groupBy: [], having: [],
        orderBy: [], aggregates: [], aggregateMode: false, functionMode: false, computedColumns: [],
        setOperation: '', setOperationQuery: '', windowFunctions: [], ctes: [],
        selectedColumns: [], selectAll: true, limitValue: '', offsetValue: '', dialect: 'sqlite'
    };

    if (!remaining) return snapshot;

    // Strip trailing semicolon
    remaining = remaining.replace(/;\s*$/, '').trim();

    // 1. Extract CTEs
    const withMatch = remaining.match(/^\s*WITH\s+/i);
    if (withMatch) {
        remaining = remaining.slice(withMatch[0].length);
        while (true) {
            const nameMatch = remaining.match(/^(\w+)\s+AS\s*\(/i);
            if (!nameMatch) break;
            const cteName = nameMatch[1];
            remaining = remaining.slice(nameMatch[0].length);
            const cteBody = extractBalancedParens(remaining);
            remaining = remaining.slice(cteBody.length + 1); // +1 for closing paren
            snapshot.ctes.push({ name: cteName, query: cteBody.trim() });
            const commaMatch = remaining.match(/^\s*,\s*/);
            if (commaMatch) { remaining = remaining.slice(commaMatch[0].length); }
            else break;
        }
        remaining = remaining.trim();
    }

    // 2. Normalize whitespace (after CTE extraction to preserve CTE body)
    remaining = remaining.replace(/\s+/g, ' ').trim();

    // 3. Extract set operations
    const setOps = ['UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT'];
    for (const op of setOps) {
        const idx = findTopLevelKeyword(remaining, op);
        if (idx !== -1) {
            snapshot.setOperation = op;
            snapshot.setOperationQuery = remaining.slice(idx + op.length).trim();
            remaining = remaining.slice(0, idx).trim();
            break;
        }
    }

    // 4. Extract LIMIT / OFFSET (from end)
    const limitMatch = remaining.match(/\bLIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?\s*$/i);
    if (limitMatch) {
        snapshot.limitValue = limitMatch[1];
        if (limitMatch[2]) snapshot.offsetValue = limitMatch[2];
        remaining = remaining.slice(0, limitMatch.index).trim();
    }

    // 5. Extract ORDER BY
    const orderByIdx = findTopLevelKeyword(remaining, 'ORDER BY');
    if (orderByIdx !== -1) {
        parseOrderByClause(remaining.slice(orderByIdx + 8).trim(), snapshot);
        remaining = remaining.slice(0, orderByIdx).trim();
    }

    // 6. Extract HAVING
    const havingIdx = findTopLevelKeyword(remaining, 'HAVING');
    if (havingIdx !== -1) {
        parseHavingClause(remaining.slice(havingIdx + 6).trim(), snapshot);
        remaining = remaining.slice(0, havingIdx).trim();
    }

    // 7. Extract GROUP BY
    const groupByIdx = findTopLevelKeyword(remaining, 'GROUP BY');
    if (groupByIdx !== -1) {
        snapshot.groupBy = remaining.slice(groupByIdx + 8).trim().split(',').map(s => s.trim());
        remaining = remaining.slice(0, groupByIdx).trim();
    }

    // 8. Extract WHERE
    const whereIdx = findTopLevelKeyword(remaining, 'WHERE');
    if (whereIdx !== -1) {
        parseWhereClause(remaining.slice(whereIdx + 5).trim(), snapshot);
        remaining = remaining.slice(0, whereIdx).trim();
    }

    // 9. Extract FROM + JOINs
    const fromIdx = findTopLevelKeyword(remaining, 'FROM');
    if (fromIdx !== -1) {
        parseFromAndJoins(remaining.slice(fromIdx + 4).trim(), snapshot);
        remaining = remaining.slice(0, fromIdx).trim();
    }

    // 10. Parse SELECT clause
    parseSelectClause(remaining, snapshot);

    return snapshot;
}

function tryParseAndRestore(sql, options) {
    try {
        const snapshot = parseSQL(sql);
        if (!snapshot.mainTable || !state.tables.includes(snapshot.mainTable)) return false;
        for (const j of snapshot.joins) {
            if (j.table && !state.tables.includes(j.table)) return false;
        }
        restoreBuilderState(snapshot, options);
        return true;
    } catch (e) {
        console.warn('SQL parse failed:', e);
        return false;
    }
}

function updateSQL() {
    const sql = buildSQL();
    const preview = document.getElementById('sqlPreview');
    if (sql) {
        const displaySQL = state.dialect !== 'sqlite' ? convertSQL(sql, state.dialect) : sql;
        preview.innerHTML = highlightSQL(displaySQL);
    } else {
        preview.innerHTML = '<span class="sql-comment">-- Build your query using the options on the left</span>';
    }
    // Keep ORDER BY dropdown in sync with aggregates/functions/windows
    if (document.getElementById('orderByList').children.length > 0) {
        renderOrderBy();
    }
}

function highlightSQL(sql) {
    const keywords = ['SELECT','FROM','WHERE','JOIN','INNER JOIN','LEFT JOIN','RIGHT JOIN','CROSS JOIN',
                       'ON','AND','OR','GROUP BY','ORDER BY','HAVING','LIMIT','OFFSET','AS','DISTINCT',
                       'BETWEEN','LIKE','NOT LIKE','IN','NOT IN','IS NULL','IS NOT NULL','ASC','DESC',
                       'UNION','UNION ALL','INTERSECT','EXCEPT','WITH','OVER','PARTITION BY',
                       'ROW_NUMBER','RANK','DENSE_RANK','NTILE','LAG','LEAD','ROWS','RANGE','UNBOUNDED','PRECEDING','FOLLOWING','CURRENT ROW',
                       'TOP','FETCH','FIRST','ONLY','NEXT','SKIP'];
    const functions = ['COUNT','SUM','AVG','MIN','MAX','UPPER','LOWER','LENGTH','TRIM','SUBSTR','REPLACE','INSTR',
                        'DATE','TIME','DATETIME','STRFTIME','julianday',
                        'SUBSTRING','LEN','CHAR_LENGTH','CHARINDEX','POSITION',
                        'DATE_FORMAT','TO_CHAR','FORMAT','CONCAT','LTRIM','RTRIM',
                        'NOW','GETDATE','SYSDATE','EXTRACT'];

    let escaped = escapeHtml(sql);

    keywords.sort((a, b) => b.length - a.length);
    keywords.forEach(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'gi');
        escaped = escaped.replace(regex, `<span class="sql-keyword">${kw}</span>`);
    });

    functions.forEach(fn => {
        const regex = new RegExp(`\\b${fn}\\b`, 'gi');
        escaped = escaped.replace(regex, `<span class="sql-function">${fn}</span>`);
    });

    escaped = escaped.replace(/'([^']*)'/g, `<span class="sql-string">'$1'</span>`);
    escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="sql-number">$1</span>');

    return escaped;
}

// ============ SQL Dialect Conversion ============
function setDialect(dialect) {
    state.dialect = dialect;
    document.querySelectorAll('.dialect-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.dialect === dialect);
    });
    const notice = document.getElementById('dialectNotice');
    if (notice) notice.style.display = dialect === 'sqlite' ? 'none' : '';
    updateSQL();
}

function convertSQL(sql, dialect) {
    switch (dialect) {
        case 'mysql': return convertToMySQL(sql);
        case 'postgresql': return convertToPostgreSQL(sql);
        case 'sqlserver': return convertToSQLServer(sql);
        case 'oracle': return convertToOracle(sql);
        case 'db2': return convertToDB2(sql);
        case 'firebirdsql': return convertToFirebird(sql);
        default: return sql;
    }
}

function convertToMySQL(sql) {
    let r = sql;
    // SUBSTR -> SUBSTRING
    r = r.replace(/\bSUBSTR\s*\(/gi, 'SUBSTRING(');
    // STRFTIME('fmt', col) -> DATE_FORMAT(col, 'fmt')
    r = r.replace(/\bSTRFTIME\s*\(\s*'([^']*)'\s*,\s*([^)]+)\)/gi, "DATE_FORMAT($2, '$1')");
    // String concat || -> CONCAT()
    r = r.replace(/(\b\w+(?:\.\w+)?)\s*\|\|\s*(\b\w+(?:\.\w+)?)/g, 'CONCAT($1, $2)');
    // LIMIT/OFFSET syntax is the same in MySQL
    return r;
}

function convertToPostgreSQL(sql) {
    let r = sql;
    // SUBSTR -> SUBSTRING
    r = r.replace(/\bSUBSTR\s*\(/gi, 'SUBSTRING(');
    // STRFTIME('fmt', col) -> TO_CHAR(col, 'fmt')
    r = r.replace(/\bSTRFTIME\s*\(\s*'([^']*)'\s*,\s*([^)]+)\)/gi, "TO_CHAR($2, '$1')");
    // INSTR(a, b) -> POSITION(b IN a)
    r = r.replace(/\bINSTR\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/gi, 'POSITION($2 IN $1)');
    // LIMIT/OFFSET syntax is the same in PostgreSQL
    return r;
}

function convertToSQLServer(sql) {
    let r = sql;
    // SUBSTR -> SUBSTRING
    r = r.replace(/\bSUBSTR\s*\(/gi, 'SUBSTRING(');
    // LENGTH -> LEN
    r = r.replace(/\bLENGTH\s*\(/gi, 'LEN(');
    // STRFTIME('fmt', col) -> FORMAT(col, 'fmt')
    r = r.replace(/\bSTRFTIME\s*\(\s*'([^']*)'\s*,\s*([^)]+)\)/gi, "FORMAT($2, '$1')");
    // INSTR(a, b) -> CHARINDEX(b, a)
    r = r.replace(/\bINSTR\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/gi, 'CHARINDEX($2, $1)');
    // TRIM(x) -> LTRIM(RTRIM(x))
    r = r.replace(/\bTRIM\s*\(\s*([^)]+)\)/gi, 'LTRIM(RTRIM($1))');
    // String concat || -> +
    r = r.replace(/\s*\|\|\s*/g, ' + ');
    // LIMIT n OFFSET m -> OFFSET m ROWS FETCH NEXT n ROWS ONLY
    const limitOffsetMatch = r.match(/\nLIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i);
    const limitOnlyMatch = r.match(/\nLIMIT\s+(\d+)/i);
    if (limitOffsetMatch) {
        const lim = limitOffsetMatch[1], off = limitOffsetMatch[2];
        r = r.replace(/\nLIMIT\s+\d+\s+OFFSET\s+\d+/i, '');
        if (!/ORDER BY/i.test(r)) r += '\nORDER BY (SELECT NULL)';
        r += `\nOFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY`;
    } else if (limitOnlyMatch) {
        const lim = limitOnlyMatch[1];
        r = r.replace(/\nLIMIT\s+\d+/i, '');
        r = r.replace(/\bSELECT\b/i, `SELECT TOP ${lim}`);
    }
    return r;
}

function convertToOracle(sql) {
    let r = sql;
    // STRFTIME('fmt', col) -> TO_CHAR(col, 'fmt')
    r = r.replace(/\bSTRFTIME\s*\(\s*'([^']*)'\s*,\s*([^)]+)\)/gi, "TO_CHAR($2, '$1')");
    // LIMIT/OFFSET -> FETCH FIRST / OFFSET ROWS FETCH NEXT
    const limitOffsetMatch = r.match(/\nLIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i);
    const limitOnlyMatch = r.match(/\nLIMIT\s+(\d+)/i);
    if (limitOffsetMatch) {
        const lim = limitOffsetMatch[1], off = limitOffsetMatch[2];
        r = r.replace(/\nLIMIT\s+\d+\s+OFFSET\s+\d+/i, '');
        r += `\nOFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY`;
    } else if (limitOnlyMatch) {
        const lim = limitOnlyMatch[1];
        r = r.replace(/\nLIMIT\s+\d+/i, '');
        r += `\nFETCH FIRST ${lim} ROWS ONLY`;
    }
    return r;
}

function convertToDB2(sql) {
    let r = sql;
    // STRFTIME -> TO_CHAR
    r = r.replace(/\bSTRFTIME\s*\(\s*'([^']*)'\s*,\s*([^)]+)\)/gi, "TO_CHAR($2, '$1')");
    // LIMIT/OFFSET -> FETCH FIRST / OFFSET ROWS FETCH NEXT
    const limitOffsetMatch = r.match(/\nLIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i);
    const limitOnlyMatch = r.match(/\nLIMIT\s+(\d+)/i);
    if (limitOffsetMatch) {
        const lim = limitOffsetMatch[1], off = limitOffsetMatch[2];
        r = r.replace(/\nLIMIT\s+\d+\s+OFFSET\s+\d+/i, '');
        r += `\nOFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY`;
    } else if (limitOnlyMatch) {
        const lim = limitOnlyMatch[1];
        r = r.replace(/\nLIMIT\s+\d+/i, '');
        r += `\nFETCH FIRST ${lim} ROWS ONLY`;
    }
    return r;
}

function convertToFirebird(sql) {
    let r = sql;
    // SUBSTR -> SUBSTRING
    r = r.replace(/\bSUBSTR\s*\(/gi, 'SUBSTRING(');
    // LENGTH -> CHAR_LENGTH
    r = r.replace(/\bLENGTH\s*\(/gi, 'CHAR_LENGTH(');
    // STRFTIME not directly supported, approximate with EXTRACT
    r = r.replace(/\bSTRFTIME\s*\(\s*'([^']*)'\s*,\s*([^)]+)\)/gi, "EXTRACT(YEAR FROM $2)");
    // LIMIT n OFFSET m -> SELECT FIRST n SKIP m
    const limitOffsetMatch = r.match(/\nLIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i);
    const limitOnlyMatch = r.match(/\nLIMIT\s+(\d+)/i);
    if (limitOffsetMatch) {
        const lim = limitOffsetMatch[1], off = limitOffsetMatch[2];
        r = r.replace(/\nLIMIT\s+\d+\s+OFFSET\s+\d+/i, '');
        r = r.replace(/\bSELECT\b/i, `SELECT FIRST ${lim} SKIP ${off}`);
    } else if (limitOnlyMatch) {
        const lim = limitOnlyMatch[1];
        r = r.replace(/\nLIMIT\s+\d+/i, '');
        r = r.replace(/\bSELECT\b/i, `SELECT FIRST ${lim}`);
    }
    return r;
}

// ============ Run Query ============
async function runQuery() {
    let sql;
    if (state.mode === 'sql') {
        sql = document.getElementById('rawSqlInput').value.trim();
    } else {
        sql = buildSQL();
    }

    if (!sql) { toast('No query to run', 'error'); return; }

    const btn = document.getElementById('runBtn');
    btn.innerHTML = '<span class="spinner"></span> Running...';
    btn.disabled = true;

    const startTime = performance.now();

    try {
        const res = await fetch('/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql })
        });
        const data = await res.json();
        const elapsed = Math.round(performance.now() - startTime);

        if (data.error) { toast(data.error, 'error'); return; }

        state.lastResult = data;
        state.sortCol = -1;
        state.sortDir = 'asc';
        state.currentPage = 1;

        if (state.mode === 'sql') {
            document.getElementById('sqlPreview').innerHTML = highlightSQL(sql);
            // Silently sync visual builder state (stay in SQL editor mode)
            tryParseAndRestore(sql, { switchMode: false });
        }

        renderResults(data, elapsed);
        addToHistory(sql, data.row_count, elapsed);
        toast(`${data.row_count} rows returned in ${elapsed}ms`, 'success');
    } catch (err) {
        toast('Failed to execute query', 'error');
    } finally {
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Query`;
        btn.disabled = false;
    }
}

// ============ Render Results ============
function renderResults(data, elapsed) {
    const table = document.getElementById('resultsTable');
    const empty = document.getElementById('emptyState');
    const toolbar = document.getElementById('resultsToolbar');
    const pagination = document.getElementById('paginationBar');

    empty.style.display = 'none';
    table.style.display = '';
    toolbar.style.display = '';

    document.getElementById('rowCount').textContent = `${data.row_count} rows`;
    document.getElementById('queryTime').textContent = elapsed ? `${elapsed}ms` : '';

    renderResultsTable(data);

    if (data.row_count > 25) {
        pagination.style.display = '';
        renderPagination();
    } else {
        pagination.style.display = 'none';
    }
}

function renderResultsTable(data) {
    const thead = document.getElementById('resultsHead');
    const tbody = document.getElementById('resultsBody');

    thead.innerHTML = '<tr>' + data.columns.map((c, i) => {
        const sortIcon = state.sortCol === i ? (state.sortDir === 'asc' ? '↑' : '↓') : '↕';
        const sortedClass = state.sortCol === i ? 'sorted' : '';
        return `<th class="${sortedClass}" onclick="sortResults(${i})">${escapeHtml(c)} <span class="sort-icon">${sortIcon}</span></th>`;
    }).join('') + '</tr>';

    let rows = [...data.rows];
    if (state.sortCol >= 0) {
        rows.sort((a, b) => {
            let va = a[state.sortCol], vb = b[state.sortCol];
            if (va === null) return 1;
            if (vb === null) return -1;
            if (typeof va === 'number' && typeof vb === 'number') {
                return state.sortDir === 'asc' ? va - vb : vb - va;
            }
            va = String(va).toLowerCase();
            vb = String(vb).toLowerCase();
            if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
            if (va > vb) return state.sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    const pageSize = state.pageSize;
    const startIdx = pageSize > 0 ? (state.currentPage - 1) * pageSize : 0;
    const pageRows = pageSize > 0 ? rows.slice(startIdx, startIdx + pageSize) : rows;

    tbody.innerHTML = '';
    pageRows.forEach(row => {
        const tr = document.createElement('tr');
        row.forEach(val => {
            const td = document.createElement('td');
            if (val === null || val === undefined) {
                td.textContent = 'NULL';
                td.className = 'null-val';
            } else if (typeof val === 'number') {
                td.textContent = val;
                td.className = 'num-val';
            } else {
                td.textContent = val;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

// ============ Sorting ============
function sortResults(colIdx) {
    if (state.sortCol === colIdx) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortCol = colIdx;
        state.sortDir = 'asc';
    }
    renderResultsTable(state.lastResult);
    renderPagination();
}

// ============ Pagination ============
function renderPagination() {
    if (!state.lastResult) return;
    const total = state.lastResult.row_count;
    const pageSize = state.pageSize;
    if (pageSize === 0) {
        document.getElementById('paginationBar').style.display = 'none';
        return;
    }

    const totalPages = Math.ceil(total / pageSize);
    state.currentPage = Math.min(state.currentPage, totalPages);

    document.getElementById('pageInfo').textContent =
        `${(state.currentPage - 1) * pageSize + 1}–${Math.min(state.currentPage * pageSize, total)} of ${total}`;

    document.getElementById('prevBtn').disabled = state.currentPage <= 1;
    document.getElementById('nextBtn').disabled = state.currentPage >= totalPages;

    const nums = document.getElementById('pageNumbers');
    nums.innerHTML = '';
    const maxShow = 5;
    let start = Math.max(1, state.currentPage - Math.floor(maxShow / 2));
    let end = Math.min(totalPages, start + maxShow - 1);
    if (end - start < maxShow - 1) start = Math.max(1, end - maxShow + 1);

    for (let p = start; p <= end; p++) {
        const btn = document.createElement('button');
        btn.className = 'page-num' + (p === state.currentPage ? ' active' : '');
        btn.textContent = p;
        btn.onclick = () => { state.currentPage = p; renderResultsTable(state.lastResult); renderPagination(); };
        nums.appendChild(btn);
    }
}

function prevPage() {
    if (state.currentPage > 1) {
        state.currentPage--;
        renderResultsTable(state.lastResult);
        renderPagination();
    }
}

function nextPage() {
    const totalPages = Math.ceil(state.lastResult.row_count / state.pageSize);
    if (state.currentPage < totalPages) {
        state.currentPage++;
        renderResultsTable(state.lastResult);
        renderPagination();
    }
}

function changePageSize() {
    state.pageSize = parseInt(document.getElementById('pageSizeSelect').value);
    state.currentPage = 1;
    renderResultsTable(state.lastResult);
    renderPagination();
}

// ============ Filter Results ============
function filterResults() {
    const query = document.getElementById('resultSearch').value.toLowerCase();
    const rows = document.querySelectorAll('#resultsBody tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.classList.toggle('hidden-row', query && !text.includes(query));
    });
}

// ============ Export ============
function toggleExportMenu() {
    const menu = document.getElementById('exportMenu');
    menu.style.display = menu.style.display === 'none' ? '' : 'none';
}

async function exportResults(format) {
    document.getElementById('exportMenu').style.display = 'none';
    if (!state.lastResult) { toast('No results to export', 'error'); return; }

    try {
        const res = await fetch('/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                columns: state.lastResult.columns,
                rows: state.lastResult.rows,
                format,
                table_name: state.mainTable
            })
        });

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `query_results.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast(`Exported as ${format.toUpperCase()}`, 'success');
    } catch {
        toast('Export failed', 'error');
    }
}

// ============ Copy ============
function copySQL() {
    let sql = state.mode === 'sql' ? document.getElementById('rawSqlInput').value : buildSQL();
    if (!sql) { toast('No SQL to copy', 'error'); return; }
    if (state.dialect !== 'sqlite') sql = convertSQL(sql, state.dialect);
    navigator.clipboard.writeText(sql).then(() => toast('SQL copied to clipboard', 'info'));
}

function copyResults() {
    if (!state.lastResult) { toast('No results to copy', 'error'); return; }
    const { columns, rows } = state.lastResult;
    const csv = [columns.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(csv).then(() => toast('Results copied as TSV', 'info'));
}

// ============ AI (Gemini) ============
async function fetchSampleData() {
    try {
        const res = await fetch('/sample_data');
        const data = await res.json();
        if (!data.error) {
            state.sampleData = data;
            document.getElementById('aiSection').style.display = '';
        }
    } catch (err) {
        console.log('Failed to fetch sample data for AI:', err);
    }
}

function buildAIPrompt(question) {
    let prompt = `You are a SQL expert. Generate a single SQLite SELECT query to answer the user's question.\n\n`;
    prompt += `DATABASE SCHEMA:\n`;

    for (const [table, info] of Object.entries(state.schema)) {
        prompt += `\nTable: ${table}\n`;
        prompt += `Columns:\n`;
        for (const col of info.columns) {
            let colDesc = `  - ${col.name} (${col.type || 'TEXT'})`;
            if (col.pk) colDesc += ' [PRIMARY KEY]';
            if (col.notnull) colDesc += ' [NOT NULL]';
            prompt += colDesc + '\n';
        }
        if (info.foreign_keys && info.foreign_keys.length > 0) {
            prompt += `Foreign Keys:\n`;
            for (const fk of info.foreign_keys) {
                prompt += `  - ${fk.from_column} -> ${fk.to_table}(${fk.to_column})\n`;
            }
        }
    }

    prompt += `\nSAMPLE DATA (first 3 rows per table):\n`;
    for (const [table, rows] of Object.entries(state.sampleData)) {
        if (rows.length > 0) {
            prompt += `\n${table}:\n`;
            prompt += JSON.stringify(rows, null, 2) + '\n';
        }
    }

    prompt += `\nUSER QUESTION: ${question}\n\n`;
    prompt += `RULES:\n`;
    prompt += `- Return ONLY the raw SQL query, nothing else.\n`;
    prompt += `- Do NOT include any explanation, markdown, or code fences.\n`;
    prompt += `- Only generate SELECT queries (no INSERT, UPDATE, DELETE).\n`;
    prompt += `- Use proper SQLite syntax.\n`;
    prompt += `- Use JOINs when data spans multiple tables.\n`;
    prompt += `- Use the exact column and table names from the schema.\n`;

    return prompt;
}

async function askAI() {
    const input = document.getElementById('aiInput');
    const question = input.value.trim();
    if (!question) { toast('Please enter a question', 'error'); return; }

    const responseDiv = document.getElementById('aiResponse');
    const thinkingDiv = document.getElementById('aiThinking');
    const errorDiv = document.getElementById('aiError');
    const resultDiv = document.getElementById('aiResult');

    responseDiv.style.display = '';
    thinkingDiv.style.display = 'flex';
    errorDiv.style.display = 'none';
    resultDiv.style.display = 'none';

    try {
        const prompt = buildAIPrompt(question);
        const res = await fetch('/ai/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: 'You are a SQL expert. Return ONLY the raw SQL query, nothing else. No explanations, no markdown.' },
                    { role: 'user', content: prompt }
                ]
            })
        });
        const data = await res.json();
        if (!res.ok) {
            const errMsg = typeof data.error === 'string' ? data.error : (data.error?.message || 'AI request failed.');
            throw new Error(errMsg);
        }
        let sql = data.choices?.[0]?.message?.content || '';

        // Clean up: strip markdown code fences if present
        sql = sql.trim();
        if (sql.startsWith('```sql')) sql = sql.slice(6);
        else if (sql.startsWith('```')) sql = sql.slice(3);
        if (sql.endsWith('```')) sql = sql.slice(0, -3);
        sql = sql.trim();

        if (!sql) throw new Error('No SQL generated. Try rephrasing your question.');

        state.aiGeneratedSQL = sql;
        document.getElementById('aiSQLPreview').innerHTML = highlightSQL(sql);
        thinkingDiv.style.display = 'none';
        resultDiv.style.display = '';

    } catch (err) {
        thinkingDiv.style.display = 'none';
        errorDiv.style.display = '';
        errorDiv.textContent = err.message || 'Something went wrong. Please try again.';
    }
}

function useAIQuery() {
    if (!state.aiGeneratedSQL) return;
    const sql = state.aiGeneratedSQL;

    // Try to parse SQL into visual builder; fall back to SQL editor mode
    if (!tryParseAndRestore(sql)) {
        setMode('sql');
        document.getElementById('rawSqlInput').value = sql;
        document.getElementById('sqlPreview').innerHTML = highlightSQL(sql);
    }

    runQuery();
    // Clear AI section after using the query
    document.getElementById('aiInput').value = '';
    document.getElementById('aiResponse').style.display = 'none';
    document.getElementById('aiResult').style.display = 'none';
    state.aiGeneratedSQL = '';
}

function copyAISQL() {
    if (!state.aiGeneratedSQL) { toast('No SQL to copy', 'error'); return; }
    navigator.clipboard.writeText(state.aiGeneratedSQL).then(() => toast('AI SQL copied to clipboard', 'info'));
}

// ============ Reset ============
function resetQuery() {
    state.joins = [];
    state.conditions = [];
    state.groupBy = [];
    state.having = [];
    state.orderBy = [];
    state.aggregates = [];
    state.distinct = false;
    state.aggregateMode = false;
    state.functionMode = false;
    state.computedColumns = [];
    state.setOperation = '';
    state.setOperationQuery = '';
    state.windowFunctions = [];
    state.ctes = [];
    state.dialect = 'sqlite';

    document.getElementById('selectAll').checked = true;
    document.getElementById('limitValue').value = '';
    document.getElementById('offsetValue').value = '';
    document.getElementById('aggregateSection').style.display = 'none';
    document.getElementById('aggToggleBtn').classList.remove('active');
    document.getElementById('distinctBadge').classList.remove('active');
    document.getElementById('functionSection').style.display = 'none';
    document.getElementById('funcToggleBtn').classList.remove('active');
    document.getElementById('setOpsType').value = '';
    document.getElementById('setOpsQueryWrap').style.display = 'none';
    document.getElementById('setOpsQuery').value = '';
    document.querySelectorAll('.dialect-btn').forEach(b => b.classList.toggle('active', b.dataset.dialect === 'sqlite'));
    const dialectNotice = document.getElementById('dialectNotice');
    if (dialectNotice) dialectNotice.style.display = 'none';

    // Reset AI section
    state.aiGeneratedSQL = '';
    document.getElementById('aiInput').value = '';
    document.getElementById('aiResponse').style.display = 'none';
    document.getElementById('aiThinking').style.display = 'none';
    document.getElementById('aiError').style.display = 'none';
    document.getElementById('aiResult').style.display = 'none';

    renderColumnCheckboxes();
    renderJoins();
    renderConditions();
    renderGroupBy();
    renderHaving();
    renderOrderBy();
    renderWindowFunctions();
    renderCTEs();
    updateJoinCount();
    updateWhereCount();
    updateSQL();
    toast('Query reset', 'info');
}

// ============ History ============
function addToHistory(sql, rowCount, elapsed) {
    state.history.unshift({
        sql,
        rowCount,
        elapsed,
        timestamp: new Date().toISOString()
    });
    if (state.history.length > 50) state.history.pop();
    localStorage.setItem('hellosql_history', JSON.stringify(state.history));
    renderHistory();
}

function renderHistory() {
    const container = document.getElementById('historyList');
    if (state.history.length === 0) {
        container.innerHTML = '<p class="empty-hint">No queries yet</p>';
        return;
    }

    container.innerHTML = '';
    state.history.forEach((h, i) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.onclick = () => {
            setMode('sql');
            document.getElementById('rawSqlInput').value = h.sql;
            document.getElementById('sqlPreview').innerHTML = highlightSQL(h.sql);
            toggleHistory();
        };

        const time = new Date(h.timestamp);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });

        div.innerHTML = `
            <div class="history-sql">${escapeHtml(h.sql)}</div>
            <div class="history-meta">
                <span>${h.rowCount} rows · ${h.elapsed}ms</span>
                <span>${dateStr} ${timeStr}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

function clearHistory() {
    state.history = [];
    localStorage.removeItem('hellosql_history');
    renderHistory();
    toast('History cleared', 'info');
}

// ============ Saved Queries ============
function captureBuilderState() {
    const checkedCols = [...document.querySelectorAll('.col-cb:checked')].map(cb => cb.dataset.col);
    return {
        mainTable: state.mainTable,
        distinct: state.distinct,
        joins: JSON.parse(JSON.stringify(state.joins)),
        conditions: JSON.parse(JSON.stringify(state.conditions)),
        groupBy: [...state.groupBy],
        having: JSON.parse(JSON.stringify(state.having)),
        orderBy: JSON.parse(JSON.stringify(state.orderBy)),
        aggregates: JSON.parse(JSON.stringify(state.aggregates)),
        aggregateMode: state.aggregateMode,
        functionMode: state.functionMode,
        computedColumns: JSON.parse(JSON.stringify(state.computedColumns)),
        setOperation: state.setOperation,
        setOperationQuery: document.getElementById('setOpsQuery') ? document.getElementById('setOpsQuery').value : '',
        windowFunctions: JSON.parse(JSON.stringify(state.windowFunctions)),
        ctes: JSON.parse(JSON.stringify(state.ctes)),
        selectedColumns: checkedCols,
        selectAll: document.getElementById('selectAll').checked,
        limitValue: document.getElementById('limitValue').value,
        offsetValue: document.getElementById('offsetValue').value,
        dialect: state.dialect
    };
}

function restoreBuilderState(snapshot, options = {}) {
    // Set table first
    const tableSelect = document.getElementById('mainTable');
    tableSelect.value = snapshot.mainTable;
    state.mainTable = snapshot.mainTable;

    if (!snapshot.mainTable) return;

    // Restore state properties
    state.joins = snapshot.joins || [];
    state.conditions = snapshot.conditions || [];
    state.groupBy = snapshot.groupBy || [];
    state.having = snapshot.having || [];
    state.orderBy = snapshot.orderBy || [];
    state.aggregates = snapshot.aggregates || [];
    state.aggregateMode = snapshot.aggregateMode || false;
    state.distinct = snapshot.distinct || false;
    state.functionMode = snapshot.functionMode || false;
    state.computedColumns = snapshot.computedColumns || [];
    state.setOperation = snapshot.setOperation || '';
    state.windowFunctions = snapshot.windowFunctions || [];
    state.ctes = snapshot.ctes || [];

    showQuerySections();
    renderColumnCheckboxes();

    // Restore select all / individual columns
    const selectAllEl = document.getElementById('selectAll');
    selectAllEl.checked = snapshot.selectAll !== false;
    if (!selectAllEl.checked && snapshot.selectedColumns) {
        document.querySelectorAll('.col-cb').forEach(cb => {
            cb.disabled = false;
            cb.checked = snapshot.selectedColumns.includes(cb.dataset.col);
        });
    } else {
        handleSelectAll();
    }

    // Restore distinct
    document.getElementById('distinctBadge').classList.toggle('active', state.distinct);

    // Restore aggregates
    document.getElementById('aggToggleBtn').classList.toggle('active', state.aggregateMode);
    document.getElementById('aggregateSection').style.display = state.aggregateMode ? '' : 'none';
    if (state.aggregateMode) renderAggregates();

    // Restore functions
    document.getElementById('funcToggleBtn').classList.toggle('active', state.functionMode);
    document.getElementById('functionSection').style.display = state.functionMode ? '' : 'none';
    if (state.functionMode) renderComputedColumns();

    // Restore limit/offset
    document.getElementById('limitValue').value = snapshot.limitValue || '';
    document.getElementById('offsetValue').value = snapshot.offsetValue || '';

    // Restore set operations
    document.getElementById('setOpsType').value = state.setOperation;
    document.getElementById('setOpsQueryWrap').style.display = state.setOperation ? '' : 'none';
    document.getElementById('setOpsQuery').value = snapshot.setOperationQuery || '';

    // Render all sections
    renderJoins();
    renderConditions();
    renderGroupBy();
    renderHaving();
    renderOrderBy();
    renderWindowFunctions();
    renderCTEs();
    updateJoinCount();
    updateWhereCount();
    updateSQL();

    // Restore dialect
    if (snapshot.dialect && snapshot.dialect !== 'sqlite') {
        setDialect(snapshot.dialect);
    }

    if (options.switchMode !== false) setMode('visual');
}

function showSaveQueryDialog() {
    const sql = buildSQL();
    if (!sql && state.mode !== 'sql') {
        toast('No query to save', 'error');
        return;
    }
    document.getElementById('saveQueryModal').style.display = '';
    const input = document.getElementById('saveQueryName');
    input.value = '';
    input.focus();
}

function closeSaveModal() {
    document.getElementById('saveQueryModal').style.display = 'none';
}

function saveQuery() {
    const name = document.getElementById('saveQueryName').value.trim();
    if (!name) { toast('Enter a query name', 'error'); return; }

    const sql = state.mode === 'sql' ? document.getElementById('rawSqlInput').value : buildSQL();

    const entry = {
        id: Date.now(),
        name,
        sql,
        builderState: captureBuilderState(),
        createdAt: new Date().toISOString()
    };

    state.savedQueries.unshift(entry);
    localStorage.setItem('hellosql_saved_queries', JSON.stringify(state.savedQueries));
    renderSavedQueries();
    closeSaveModal();
    toast(`Query "${name}" saved`, 'success');
}

function loadSavedQuery(id) {
    const entry = state.savedQueries.find(q => q.id === id);
    if (!entry) return;

    if (entry.builderState && entry.builderState.mainTable && state.tables.includes(entry.builderState.mainTable)) {
        restoreBuilderState(entry.builderState);
    } else {
        // Fallback to SQL mode
        setMode('sql');
        document.getElementById('rawSqlInput').value = entry.sql;
        document.getElementById('sqlPreview').innerHTML = highlightSQL(entry.sql);
    }
    toggleSavedQueries();
    toast(`Loaded "${entry.name}"`, 'info');
}

function deleteSavedQuery(id, e) {
    e.stopPropagation();
    state.savedQueries = state.savedQueries.filter(q => q.id !== id);
    localStorage.setItem('hellosql_saved_queries', JSON.stringify(state.savedQueries));
    renderSavedQueries();
    toast('Query deleted', 'info');
}

function renderSavedQueries() {
    const container = document.getElementById('savedQueriesList');
    if (state.savedQueries.length === 0) {
        container.innerHTML = '<p class="empty-hint">No saved queries</p>';
        return;
    }

    container.innerHTML = '';
    state.savedQueries.forEach(q => {
        const div = document.createElement('div');
        div.className = 'saved-query-item';
        div.onclick = () => loadSavedQuery(q.id);

        const time = new Date(q.createdAt);
        const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

        div.innerHTML = `
            <button class="saved-query-delete" onclick="deleteSavedQuery(${q.id}, event)" title="Delete">×</button>
            <div class="saved-query-name">${escapeHtml(q.name)}</div>
            <div class="saved-query-sql">${escapeHtml(q.sql)}</div>
            <div class="saved-query-meta">
                <span>${dateStr}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

function toggleSavedQueries() {
    const sidebar = document.getElementById('savedSidebar');
    const overlay = document.getElementById('savedOverlay');
    const isOpen = sidebar.style.display !== 'none';
    sidebar.style.display = isOpen ? 'none' : '';
    overlay.style.display = isOpen ? 'none' : '';
    if (!isOpen) {
        document.getElementById('historySidebar').style.display = 'none';
        document.getElementById('historyOverlay').style.display = 'none';
        document.getElementById('schemaSidebar').style.display = 'none';
        document.getElementById('schemaOverlay').style.display = 'none';
    }
}

// ============ Sidebar Toggles ============
function toggleHistory() {
    const sidebar = document.getElementById('historySidebar');
    const overlay = document.getElementById('historyOverlay');
    const isOpen = sidebar.style.display !== 'none';
    sidebar.style.display = isOpen ? 'none' : '';
    overlay.style.display = isOpen ? 'none' : '';
    if (!isOpen) {
        document.getElementById('schemaSidebar').style.display = 'none';
        document.getElementById('schemaOverlay').style.display = 'none';
        document.getElementById('savedSidebar').style.display = 'none';
        document.getElementById('savedOverlay').style.display = 'none';
    }
}

function toggleSchema() {
    const sidebar = document.getElementById('schemaSidebar');
    const overlay = document.getElementById('schemaOverlay');
    const isOpen = sidebar.style.display !== 'none';
    sidebar.style.display = isOpen ? 'none' : '';
    overlay.style.display = isOpen ? 'none' : '';
    if (!isOpen) {
        document.getElementById('historySidebar').style.display = 'none';
        document.getElementById('historyOverlay').style.display = 'none';
        document.getElementById('savedSidebar').style.display = 'none';
        document.getElementById('savedOverlay').style.display = 'none';
    }
}

function closeSidebars() {
    document.getElementById('historySidebar').style.display = 'none';
    document.getElementById('historyOverlay').style.display = 'none';
    document.getElementById('schemaSidebar').style.display = 'none';
    document.getElementById('schemaOverlay').style.display = 'none';
    document.getElementById('savedSidebar').style.display = 'none';
    document.getElementById('savedOverlay').style.display = 'none';
}

// ============ Panel Resizer ============
function initResizer() {
    const resizer = document.getElementById('panelResizer');
    const panel = document.getElementById('queryPanel');
    let startX, startW;

    resizer.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startW = panel.offsetWidth;
        resizer.classList.add('dragging');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });

    function onMouseMove(e) {
        const diff = e.clientX - startX;
        const newWidth = Math.min(Math.max(startW + diff, 280), 500);
        panel.style.width = newWidth + 'px';
    }

    function onMouseUp() {
        resizer.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}

// ============ Toast Notifications ============
function toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const div = document.createElement('div');
    div.className = `toast ${type}`;

    const icons = {
        success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    div.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
    container.appendChild(div);

    setTimeout(() => {
        div.classList.add('toast-exit');
        setTimeout(() => div.remove(), 200);
    }, 3000);
}

// ============ Helpers ============
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
