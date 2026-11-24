// Initial state
let accountList = JSON.parse(localStorage.getItem('accountList')) || [
    { name: 'Cash', type: 'asset', id: 'cash' },
    { name: 'Bank', type: 'asset', id: 'bank' },
    { name: 'General', type: 'liability', id: 'general_exp' }
];

let allData = JSON.parse(localStorage.getItem('financeData')) || {};
let budgetMap = JSON.parse(localStorage.getItem('budgetMap')) || {};
let recurringRules = JSON.parse(localStorage.getItem('recurringRules')) || [];

let expenseChart = null;
let trendChart = null;
let editingState = null; // { monthKey, ids }
let lastGeneratedId = 0;

function nextUniqueId() {
    const candidate = Math.max(Date.now(), lastGeneratedId + 2);
    lastGeneratedId = candidate;
    return candidate;
}

const OVERALL_BUDGET_KEY = '__total__';

function getLocalDateString(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const dateInput = document.getElementById('date-input');
const monthFilter = document.getElementById('month-filter');
const historySearchInput = document.getElementById('history-search');
const historyTypeFilter = document.getElementById('history-type-filter');
const excelImportInput = document.getElementById('excel-import-input');

const today = getLocalDateString();
dateInput.value = today;
if (!monthFilter.value) monthFilter.value = today.slice(0, 7);

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getAccountName(id) {
    if (id === OVERALL_BUDGET_KEY) return 'Overall Monthly Spending';
    const acc = accountList.find(a => a.id === id);
    return acc ? acc.name : 'N/A';
}

function getSelectedMonth() {
    if (!monthFilter.value) {
        monthFilter.value = getLocalDateString().slice(0, 7);
    }
    return monthFilter.value;
}

// Theme (Light / Dark Mode)
function applySavedTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.body.classList.toggle('dark-mode', saved === 'dark');
    updateThemeButton();
}

function updateThemeButton() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const isDark = document.body.classList.contains('dark-mode');
    btn.innerText = isDark ? '☀️ Light' : '🌙 Dark';
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeButton();
    renderUI();
}

// Account management (Add / Rename / Delete)
function addAccountType() {
    const nameInput = document.getElementById('new-account-name');
    const typeInput = document.getElementById('new-account-type');
    const trimmedName = nameInput.value.trim();
    if (!trimmedName) return;

    const duplicate = accountList.some(
        a => a.type === typeInput.value && a.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
        alert('This account already exists in the selected category.');
        return;
    }

    const newAcc = { name: trimmedName, type: typeInput.value, id: 'acc_' + Date.now() };
    accountList.push(newAcc);
    localStorage.setItem('accountList', JSON.stringify(accountList));
    nameInput.value = '';
    initApp();
}

function renameAccount(id) {
    const targetAcc = accountList.find(a => a.id === id);
    if (!targetAcc) return;

    const proposed = prompt('Enter new account name:', targetAcc.name);
    if (proposed === null) return;

    const trimmedName = proposed.trim();
    if (!trimmedName) {
        alert('Account name cannot be empty.');
        return;
    }

    const duplicate = accountList.some(
        a => a.id !== id && a.type === targetAcc.type && a.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
        alert('Another account with this name already exists in the same category.');
        return;
    }

    targetAcc.name = trimmedName;
    localStorage.setItem('accountList', JSON.stringify(accountList));
    initApp();
}

function adjustAccountBalance(id) {
    const targetAcc = accountList.find(a => a.id === id && a.type === 'asset');
    if (!targetAcc) return;

    const balances = computeAllAssetBalances();
    const currentBalance = balances[id] || 0;

    const input = prompt(
        `Current balance for "${targetAcc.name}": ${currentBalance.toLocaleString()}đ\nEnter actual balance (VND):`,
        currentBalance
    );
    if (input === null) return;

    const actualBalance = parseFloat(input.replace(/,/g, '').trim());
    if (isNaN(actualBalance) || !isFinite(actualBalance)) {
        alert('Please enter a valid number.');
        return;
    }

    const diff = actualBalance - currentBalance;
    if (diff === 0) {
        alert('Balance is already up to date.');
        return;
    }

    const adjDate = dateInput.value || getLocalDateString();
    const monthKey = adjDate.slice(0, 7);
    if (!allData[monthKey]) allData[monthKey] = [];

    allData[monthKey].push({
        id: nextUniqueId(),
        date: adjDate,
        desc: '[Adjust] Balance adjustment',
        amount: Math.abs(diff),
        type: diff > 0 ? 'income' : 'expense',
        account: id
    });

    localStorage.setItem('financeData', JSON.stringify(allData));
    monthFilter.value = monthKey;
    renderUI();
}

function deleteAccount(id) {
    const targetAcc = accountList.find(a => a.id === id);
    if (!targetAcc) return;

    const sameTypeCount = accountList.filter(a => a.type === targetAcc.type).length;
    if (sameTypeCount <= 1) {
        alert(`You must keep at least one ${targetAcc.type === 'asset' ? 'Asset' : 'Expense'} account.`);
        return;
    }

    const isUsedInTx = Object.values(allData).some(
        monthTxs => Array.isArray(monthTxs) && monthTxs.some(t => t.account === id)
    );
    if (isUsedInTx) {
        alert('Cannot delete this account because it is used in existing transactions. Please edit or delete those transactions first.');
        return;
    }

    const isUsedInRecurring = recurringRules.some(rule => rule.accountId === id || rule.targetId === id);
    if (isUsedInRecurring) {
        alert('Cannot delete this account because it is used in a Recurring rule. Please remove that rule first.');
        return;
    }

    if (confirm('Delete this account?')) {
        accountList = accountList.filter(a => a.id !== id);
        if (budgetMap[id]) {
            delete budgetMap[id];
            localStorage.setItem('budgetMap', JSON.stringify(budgetMap));
        }
        localStorage.setItem('accountList', JSON.stringify(accountList));
        initApp();
    }
}

function toggleAccountSelect() {
    const type = document.getElementById('transaction-type').value;
    const liabilityGroup = document.getElementById('liability-group');
    const transferContainer = document.getElementById('transfer-destination-container');
    const label = document.getElementById('account-label');

    if (type === 'expense') {
        label.innerText = 'Withdraw from (Original account):';
        liabilityGroup.style.display = 'block';
        transferContainer.style.display = 'none';
    } else if (type === 'transfer') {
        label.innerText = 'From (Source account):';
        liabilityGroup.style.display = 'none';
        transferContainer.style.display = 'block';
    } else {
        label.innerText = 'To (Account):';
        liabilityGroup.style.display = 'none';
        transferContainer.style.display = 'none';
    }
}

// Budget management
function saveBudget() {
    const targetId = document.getElementById('budget-target-select').value;
    const amountInput = document.getElementById('budget-amount-input');
    const amount = parseFloat(amountInput.value);

    if (!targetId) return;
    if (isNaN(amount) || amount < 0) {
        alert('Please enter a valid budget limit (0 or higher).');
        return;
    }

    if (amount === 0) {
        delete budgetMap[targetId];
    } else {
        budgetMap[targetId] = amount;
    }

    localStorage.setItem('budgetMap', JSON.stringify(budgetMap));
    amountInput.value = '';
    renderBudgetsManager();
    renderUI();
}

function removeBudget(targetId) {
    delete budgetMap[targetId];
    localStorage.setItem('budgetMap', JSON.stringify(budgetMap));
    renderBudgetsManager();
    renderUI();
}

function renderBudgetsManager() {
    const budgetSelect = document.getElementById('budget-target-select');
    const listEl = document.getElementById('budget-list-manage');
    if (!budgetSelect || !listEl) return;

    const currentVal = budgetSelect.value;
    const expenseAccounts = accountList.filter(a => a.type === 'liability');

    budgetSelect.innerHTML =
        `<option value="${OVERALL_BUDGET_KEY}">Overall Monthly Spending</option>` +
        expenseAccounts
            .map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`)
            .join('');

    if (currentVal && [...budgetSelect.options].some(o => o.value === currentVal)) {
        budgetSelect.value = currentVal;
    }

    const entries = Object.entries(budgetMap).filter(
        ([key, val]) => val > 0 && (key === OVERALL_BUDGET_KEY || accountList.some(a => a.id === key && a.type === 'liability'))
    );

    if (entries.length === 0) {
        listEl.innerHTML = `<li class="empty-msg">No monthly budgets configured.</li>`;
        return;
    }

    listEl.innerHTML = entries
        .map(([key, limit]) => `
            <li>
                <span>${escapeHtml(getAccountName(key))}: <strong>${limit.toLocaleString()}đ</strong></span>
                <button type="button" class="btn-del-mini" onclick="removeBudget('${escapeHtml(key)}')" title="Remove budget">✕</button>
            </li>
        `)
        .join('');
}

// Recurring Transactions (Daily / Weekly / Monthly / Yearly)
function toggleRecurringSelect() {
    const isRecurring = document.getElementById('is-recurring').checked;
    document.getElementById('recurring-frequency').style.display = isRecurring ? 'inline-block' : 'none';
}

function advanceRecurringDate(dateStr, frequency) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (frequency === 'daily') {
        return getLocalDateString(new Date(y, m - 1, d + 1));
    }
    if (frequency === 'weekly') {
        return getLocalDateString(new Date(y, m - 1, d + 7));
    }
    if (frequency === 'monthly') {
        const targetMonth = (m - 1) + 1;
        const lastDay = new Date(y, targetMonth + 1, 0).getDate();
        return getLocalDateString(new Date(y, targetMonth, Math.min(d, lastDay)));
    }
    if (frequency === 'yearly') {
        const lastDay = new Date(y + 1, m, 0).getDate();
        return getLocalDateString(new Date(y + 1, m - 1, Math.min(d, lastDay)));
    }
    return dateStr;
}

function insertTransactionRecord({ dateVal, type, desc, amount, accountId, targetId }) {
    const monthKey = dateVal.slice(0, 7);
    if (!allData[monthKey]) allData[monthKey] = [];

    const now = nextUniqueId();
    if (type === 'income') {
        allData[monthKey].push({ id: now, date: dateVal, desc, amount, type: 'income', account: accountId });
    } else if (type === 'expense') {
        allData[monthKey].push({ id: now, groupId: now, date: dateVal, desc: `[Expense] ${desc}`, amount, type: 'expense', account: accountId });
        allData[monthKey].push({ id: now + 1, groupId: now, date: dateVal, desc: `[Type] ${desc}`, amount, type: 'income', account: targetId });
    } else if (type === 'transfer') {
        const srcAcc = getAccountName(accountId);
        const destAcc = getAccountName(targetId);
        allData[monthKey].push({ id: now, groupId: now, date: dateVal, desc: `[Move] ${desc} (To ${destAcc})`, amount, type: 'transfer_out', account: accountId });
        allData[monthKey].push({ id: now + 1, groupId: now, date: dateVal, desc: `[Get from] ${desc} (From ${srcAcc})`, amount, type: 'transfer_in', account: targetId });
    }
}

function recordDueRecurring() {
    const currentToday = getLocalDateString();
    let recordedCount = 0;

    recurringRules.forEach(rule => {
        const srcExists = accountList.some(a => a.id === rule.accountId);
        const targetExists = !rule.targetId || accountList.some(a => a.id === rule.targetId);
        if (!srcExists || !targetExists) return;

        while (rule.nextDate && rule.nextDate <= currentToday) {
            insertTransactionRecord({
                dateVal: rule.nextDate,
                type: rule.type,
                desc: rule.desc,
                amount: rule.amount,
                accountId: rule.accountId,
                targetId: rule.targetId
            });
            rule.nextDate = advanceRecurringDate(rule.nextDate, rule.frequency);
            recordedCount++;
        }
    });

    if (recordedCount === 0) {
        alert('No recurring transactions are due up to today.');
        return;
    }

    localStorage.setItem('financeData', JSON.stringify(allData));
    localStorage.setItem('recurringRules', JSON.stringify(recurringRules));
    renderRecurringList();
    renderUI();
}

function recordRecurringItem(ruleId) {
    const rule = recurringRules.find(r => r.id === ruleId);
    if (!rule) return;

    const srcExists = accountList.some(a => a.id === rule.accountId);
    const targetExists = !rule.targetId || accountList.some(a => a.id === rule.targetId);
    if (!srcExists || !targetExists) {
        alert('One of the accounts in this recurring rule no longer exists.');
        return;
    }

    const recordDate = rule.nextDate || getLocalDateString();
    insertTransactionRecord({
        dateVal: recordDate,
        type: rule.type,
        desc: rule.desc,
        amount: rule.amount,
        accountId: rule.accountId,
        targetId: rule.targetId
    });
    rule.nextDate = advanceRecurringDate(recordDate, rule.frequency);

    localStorage.setItem('financeData', JSON.stringify(allData));
    localStorage.setItem('recurringRules', JSON.stringify(recurringRules));
    monthFilter.value = recordDate.slice(0, 7);
    renderRecurringList();
    renderUI();
}

function deleteRecurringRule(ruleId) {
    if (!confirm('Remove this recurring transaction?')) return;
    recurringRules = recurringRules.filter(r => r.id !== ruleId);
    localStorage.setItem('recurringRules', JSON.stringify(recurringRules));
    renderRecurringList();
}

function renderRecurringList() {
    const listEl = document.getElementById('recurring-list');
    const dueBtn = document.getElementById('record-due-btn');
    if (!listEl) return;

    const currentToday = getLocalDateString();
    let dueCount = 0;

    if (recurringRules.length === 0) {
        listEl.innerHTML = `<li class="empty-msg">No recurring transactions. Check "Recurring transaction" when adding one.</li>`;
        if (dueBtn) {
            dueBtn.innerText = 'Record Due';
            dueBtn.disabled = true;
        }
        return;
    }

    const freqLabels = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

    listEl.innerHTML = recurringRules.map(rule => {
        const isDue = rule.nextDate && rule.nextDate <= currentToday;
        if (isDue) dueCount++;

        const accLabel = rule.targetId
            ? `${getAccountName(rule.accountId)} → ${getAccountName(rule.targetId)}`
            : getAccountName(rule.accountId);
        const typeColor = rule.type === 'income' ? 'blue' : (rule.type === 'expense' ? 'red' : 'orange');
        const sign = rule.type === 'income' ? '+' : (rule.type === 'expense' ? '-' : '⇄ ');
        const [, mm, dd, yy] = rule.nextDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
        const formattedNext = dd ? `${dd}/${mm}/${rule.nextDate.slice(0, 4)}` : rule.nextDate;

        return `
            <li>
                <div>
                    <strong>${escapeHtml(rule.desc)}</strong>
                    <span class="${typeColor}" style="margin-left: 6px;">${sign}${rule.amount.toLocaleString()}đ</span>
                    <span class="freq-badge">${escapeHtml(freqLabels[rule.frequency] || rule.frequency)}</span>
                    ${isDue ? '<span class="due-badge">Due</span>' : ''}<br>
                    <small style="color: var(--text-muted);">${escapeHtml(accLabel)} · Next: ${escapeHtml(formattedNext)}</small>
                </div>
                <div class="recurring-actions">
                    <button type="button" class="btn-mini-action" onclick="recordRecurringItem('${escapeHtml(rule.id)}')" title="Record next occurrence now">Record</button>
                    <button type="button" class="btn-del-mini" onclick="deleteRecurringRule('${escapeHtml(rule.id)}')" title="Remove recurring rule">✕</button>
                </div>
            </li>
        `;
    }).join('');

    if (dueBtn) {
        dueBtn.innerText = dueCount > 0 ? `Record Due (${dueCount})` : 'Record Due';
        dueBtn.disabled = dueCount === 0;
    }
}

// Transaction grouping, editing, and deleting
function groupTransactionsForHistory(transactions) {
    const groups = [];
    const usedIndices = new Set();

    for (let i = 0; i < transactions.length; i++) {
        if (usedIndices.has(i)) continue;
        const t = transactions[i];
        let partnerIndex = -1;

        if (t.groupId !== undefined) {
            partnerIndex = transactions.findIndex(
                (other, idx) => idx > i && !usedIndices.has(idx) && other.groupId === t.groupId
            );
        } else if (i + 1 < transactions.length && !usedIndices.has(i + 1)) {
            const next = transactions[i + 1];
            const isLegacyExpensePair =
                t.type === 'expense' &&
                next.type === 'income' &&
                next.id === t.id + 1 &&
                typeof next.desc === 'string' &&
                (next.desc.startsWith('[Type] ') || next.desc.startsWith('[Phân loại] '));
            const isLegacyTransferPair =
                t.type === 'transfer_out' &&
                next.type === 'transfer_in' &&
                next.id === t.id + 1;
            if (isLegacyExpensePair || isLegacyTransferPair) {
                partnerIndex = i + 1;
            }
        }

        if (partnerIndex !== -1) {
            usedIndices.add(i);
            usedIndices.add(partnerIndex);
            const partner = transactions[partnerIndex];

            if (t.type === 'expense' || partner.type === 'expense') {
                const exp = t.type === 'expense' ? t : partner;
                const liab = t.type === 'expense' ? partner : t;
                groups.push({
                    ids: [exp.id, liab.id],
                    txType: 'expense',
                    date: exp.date,
                    desc: exp.desc.replace(/^\[(Expense|Chi)\]\s*/, ''),
                    amount: exp.amount,
                    accountId: exp.account,
                    targetId: liab.account,
                    tag: `${getAccountName(exp.account)} → ${getAccountName(liab.account)}`,
                    amountText: `-${exp.amount.toLocaleString()}đ`,
                    colorClass: 'red'
                });
                continue;
            }

            if (t.type === 'transfer_out' || partner.type === 'transfer_out') {
                const outTx = t.type === 'transfer_out' ? t : partner;
                const inTx = t.type === 'transfer_out' ? partner : t;
                const cleanDesc = outTx.desc
                    .replace(/^\[Move\]\s*/, '')
                    .replace(/\s*\(To [^)]*\)$/, '');
                groups.push({
                    ids: [outTx.id, inTx.id],
                    txType: 'transfer',
                    date: outTx.date,
                    desc: cleanDesc,
                    amount: outTx.amount,
                    accountId: outTx.account,
                    targetId: inTx.account,
                    tag: `${getAccountName(outTx.account)} → ${getAccountName(inTx.account)}`,
                    amountText: `⇄ ${outTx.amount.toLocaleString()}đ`,
                    colorClass: 'orange'
                });
                continue;
            }
        }

        usedIndices.add(i);
        let colorClass = 'blue';
        let sign = '+';
        if (t.type === 'expense') { colorClass = 'red'; sign = '-'; }
        if (t.type === 'transfer_out') { colorClass = 'orange'; sign = '-'; }
        if (t.type === 'transfer_in') { colorClass = 'orange'; sign = '+'; }

        groups.push({
            ids: [t.id],
            txType: t.type,
            date: t.date,
            desc: t.desc,
            amount: t.amount,
            accountId: t.account,
            targetId: '',
            tag: getAccountName(t.account),
            amountText: `${sign}${t.amount.toLocaleString()}đ`,
            colorClass
        });
    }

    return groups;
}

function sortHistoryNewestFirst(items) {
    return items.slice().sort((a, b) => {
        const dateCmp = (b.date || '').localeCompare(a.date || '');
        if (dateCmp !== 0) return dateCmp;
        return Math.max(...b.ids) - Math.max(...a.ids);
    });
}

function startEditTransaction(monthKey, transactionIds) {
    const idsToEdit = Array.isArray(transactionIds) ? transactionIds : [transactionIds];
    const items = groupTransactionsForHistory(allData[monthKey] || []);
    const item = items.find(entry => entry.ids.join(',') === idsToEdit.join(','));
    if (!item) return;

    const editableType = (item.txType === 'transfer_out' || item.txType === 'transfer_in')
        ? 'transfer'
        : item.txType;

    document.getElementById('transaction-type').value = editableType;
    toggleAccountSelect();

    const assetSelect = document.getElementById('account-type-select');
    const liabilitySelect = document.getElementById('liability-account-select');
    const transferSelect = document.getElementById('transfer-destination-select');

    if (item.accountId && [...assetSelect.options].some(opt => opt.value === item.accountId)) {
        assetSelect.value = item.accountId;
    }
    if (editableType === 'expense' && item.targetId && [...liabilitySelect.options].some(opt => opt.value === item.targetId)) {
        liabilitySelect.value = item.targetId;
    } else if (editableType === 'transfer' && item.targetId && [...transferSelect.options].some(opt => opt.value === item.targetId)) {
        transferSelect.value = item.targetId;
    }

    dateInput.value = item.date;
    document.getElementById('desc').value = item.desc;
    document.getElementById('amount').value = item.amount;

    editingState = { monthKey, ids: item.ids };
    document.getElementById('edit-banner').style.display = 'block';
    document.getElementById('recurring-option-row').style.display = 'none';
    document.getElementById('is-recurring').checked = false;
    toggleRecurringSelect();
    document.getElementById('submit-btn').innerText = 'Save changes';
    document.getElementById('cancel-edit-btn').style.display = 'inline-block';

    document.getElementById('finance-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelEdit() {
    editingState = null;
    document.getElementById('finance-form').reset();
    dateInput.value = getLocalDateString();
    document.getElementById('edit-banner').style.display = 'none';
    document.getElementById('recurring-option-row').style.display = 'flex';
    document.getElementById('is-recurring').checked = false;
    toggleRecurringSelect();
    document.getElementById('submit-btn').innerText = 'Add';
    document.getElementById('cancel-edit-btn').style.display = 'none';
    toggleAccountSelect();
}

function deleteTransaction(monthKey, transactionIds) {
    const idsToDelete = Array.isArray(transactionIds) ? transactionIds : [transactionIds];
    if (!confirm('Are you sure you want to delete this transaction?')) return;

    if (editingState && editingState.monthKey === monthKey && editingState.ids.some(id => idsToDelete.includes(id))) {
        cancelEdit();
    }

    allData[monthKey] = (allData[monthKey] || []).filter(t => !idsToDelete.includes(t.id));
    if (allData[monthKey].length === 0) delete allData[monthKey];
    localStorage.setItem('financeData', JSON.stringify(allData));
    renderUI();
}

// App initialization
function initApp() {
    const assetSelect = document.getElementById('account-type-select');
    const liabilitySelect = document.getElementById('liability-account-select');
    const transferSelect = document.getElementById('transfer-destination-select');

    const assetOptions = accountList
        .filter(a => a.type === 'asset')
        .map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`)
        .join('');

    assetSelect.innerHTML = assetOptions;
    if (transferSelect) transferSelect.innerHTML = assetOptions;

    liabilitySelect.innerHTML = accountList
        .filter(a => a.type === 'liability')
        .map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`)
        .join('');

    const assetListEl = document.getElementById('asset-account-list');
    const expenseListEl = document.getElementById('expense-account-list');

    const renderAccountItems = (items) => {
        if (items.length === 0) {
            return `<li class="empty-msg">None</li>`;
        }
        return items.map(a => `
            <li>
                <span title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
                <div class="item-actions">
                    ${a.type === 'asset' ? `<button type="button" onclick="adjustAccountBalance('${escapeHtml(a.id)}')" class="btn-adjust-mini" title="Adjust balance">⚖</button>` : ''}
                    <button type="button" onclick="renameAccount('${escapeHtml(a.id)}')" class="btn-edit-mini" title="Rename account">✎</button>
                    <button type="button" onclick="deleteAccount('${escapeHtml(a.id)}')" class="btn-del-mini" title="Delete account">✖</button>
                </div>
            </li>
        `).join('');
    };

    if (assetListEl) {
        assetListEl.innerHTML = renderAccountItems(accountList.filter(a => a.type === 'asset'));
    }
    if (expenseListEl) {
        expenseListEl.innerHTML = renderAccountItems(accountList.filter(a => a.type === 'liability'));
    }

    renderBudgetsManager();
    renderRecurringList();
    renderUI();
}

// Shared balance & monthly cashflow calculations
function computeAllAssetBalances() {
    const totalBalances = {};
    accountList.forEach(a => {
        totalBalances[a.id] = 0;
    });

    Object.keys(allData).forEach(month => {
        (allData[month] || []).forEach(t => {
            if (!totalBalances.hasOwnProperty(t.account)) return;
            if (t.type === 'income' || t.type === 'transfer_in') {
                totalBalances[t.account] += t.amount;
            } else if (t.type === 'expense' || t.type === 'transfer_out') {
                totalBalances[t.account] -= t.amount;
            }
        });
    });

    return totalBalances;
}

function computeMonthlySummary(monthKey) {
    let income = 0;
    let expense = 0;
    const expenseByCategory = {};

    accountList.forEach(a => {
        if (a.type === 'liability') expenseByCategory[a.id] = 0;
    });

    (allData[monthKey] || []).forEach(t => {
        const accInfo = accountList.find(a => a.id === t.account);
        if (!accInfo) return;

        if (t.type === 'income') {
            if (accInfo.type === 'asset') income += t.amount;
            if (accInfo.type === 'liability') expenseByCategory[t.account] = (expenseByCategory[t.account] || 0) + t.amount;
        } else if (t.type === 'expense') {
            expense += t.amount;
        }
    });

    return { income, expense, expenseByCategory };
}

function getRecentMonths(endMonthKey, count = 6) {
    const [yearStr, monthStr] = endMonthKey.split('-');
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10);
    const months = [];

    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(year, month - 1 - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
}

// Render UI & Reports
function renderUI() {
    const selectedMonth = getSelectedMonth();
    const transactionsInMonth = allData[selectedMonth] || [];

    // Transaction history with sorting & quick filter
    const listEl = document.getElementById('transaction-list');
    const searchKeyword = (historySearchInput ? historySearchInput.value : '').trim().toLowerCase();
    const selectedType = historyTypeFilter ? historyTypeFilter.value : 'all';

    const sortedItems = sortHistoryNewestFirst(groupTransactionsForHistory(transactionsInMonth));
    const filteredItems = sortedItems.filter((item) => {
        const matchesType = selectedType === 'all' ||
            (selectedType === 'transfer'
                ? (item.txType === 'transfer' || item.txType === 'transfer_out' || item.txType === 'transfer_in')
                : item.txType === selectedType);

        if (!matchesType) return false;
        if (!searchKeyword) return true;

        return item.desc.toLowerCase().includes(searchKeyword) ||
            item.tag.toLowerCase().includes(searchKeyword);
    });

    if (filteredItems.length === 0) {
        listEl.innerHTML = `<li class="empty-msg">No transactions found.</li>`;
    } else {
        listEl.innerHTML = filteredItems.map((item) => {
            const dateParts = (item.date || '').split('-');
            const month = dateParts[1] || '--';
            const day = dateParts[2] || '--';
            const idListArg = `[${item.ids.join(',')}]`;
            const canEdit = item.txType === 'income' || item.txType === 'expense' || item.txType === 'transfer';

            return `
                <li>
                    <div>
                        <small style="color: var(--text-muted);">${escapeHtml(day)}/${escapeHtml(month)}</small><br>
                        <strong>${escapeHtml(item.desc)}</strong><br>
                        <span class="account-tag">💳 ${escapeHtml(item.tag)}</span>
                    </div>
                    <div style="text-align: right;">
                        <span class="${item.colorClass}">${escapeHtml(item.amountText)}</span>
                        <div class="history-actions">
                            ${canEdit ? `<button type="button" onclick="startEditTransaction('${escapeHtml(selectedMonth)}', ${idListArg})" class="btn-edit-mini" title="Edit transaction">✎</button>` : ''}
                            <button type="button" onclick="deleteTransaction('${escapeHtml(selectedMonth)}', ${idListArg})" class="btn-del-mini" title="Delete transaction">✕</button>
                        </div>
                    </div>
                </li>
            `;
        }).join('');
    }

    // Cumulative asset balances
    const totalBalances = computeAllAssetBalances();

    const monthlySummary = computeMonthlySummary(selectedMonth);

    // Expenditure allocation chart
    const chartLabels = [];
    const chartData = [];
    accountList.forEach(a => {
        if (a.type === 'liability' && (monthlySummary.expenseByCategory[a.id] || 0) > 0) {
            chartLabels.push(a.name);
            chartData.push(monthlySummary.expenseByCategory[a.id]);
        }
    });
    renderChart(chartLabels, chartData);

    // 6-Month Income vs Spending Trend Chart
    renderTrendChart(selectedMonth);

    // Monthly financial report
    const reportEl = document.getElementById('balance-sheet-content');
    const [yearPart, monthPart] = selectedMonth.split('-');
    document.getElementById('current-view-title').innerText = `Monthly report ${monthPart}/${yearPart}`;

    const netCashflow = monthlySummary.income - monthlySummary.expense;
    const netSign = netCashflow >= 0 ? '+' : '-';
    const netClass = netCashflow >= 0 ? 'blue' : 'red';

    let htmlContent = `
        <div class="row"><span>Monthly income:</span> <b class="blue">+${monthlySummary.income.toLocaleString()}đ</b></div>
        <div class="row"><span>Monthly spending:</span> <b class="red">-${monthlySummary.expense.toLocaleString()}đ</b></div>
        <div class="row"><span>Monthly net cashflow:</span> <b class="${netClass}">${netSign}${Math.abs(netCashflow).toLocaleString()}đ</b></div>
        <hr style="margin: 15px 0; border: 0; border-top: 1px dashed var(--border-color);">
        <h3 class="section-subheading">CURRENT ASSETS:</h3>
    `;

    let netWorth = 0;
    accountList.forEach(a => {
        if (a.type === 'asset') {
            const balance = totalBalances[a.id] || 0;
            htmlContent += `<div class="row sub-row"><span>${escapeHtml(a.name)}</span> <span>${balance.toLocaleString()}đ</span></div>`;
            netWorth += balance;
        }
    });

    reportEl.innerHTML = htmlContent;
    renderBudgetProgress(monthlySummary);
    document.getElementById('total-sum').innerText = netWorth.toLocaleString() + 'đ';
}

function renderBudgetProgress(monthlySummary) {
    const container = document.getElementById('budget-progress-section');
    if (!container) return;

    const activeBudgets = Object.entries(budgetMap).filter(
        ([key, limit]) => limit > 0 && (key === OVERALL_BUDGET_KEY || accountList.some(a => a.id === key && a.type === 'liability'))
    );

    if (activeBudgets.length === 0) {
        container.innerHTML = '';
        return;
    }

    const itemsHtml = activeBudgets.map(([key, limit]) => {
        const spent = key === OVERALL_BUDGET_KEY
            ? monthlySummary.expense
            : (monthlySummary.expenseByCategory[key] || 0);
        const pct = Math.round((spent / limit) * 100);
        const barWidth = Math.min(pct, 100);
        const barClass = pct >= 100 ? 'bar-over' : (pct >= 80 ? 'bar-warn' : 'bar-ok');
        const textClass = pct >= 100 ? 'red' : (pct >= 80 ? 'orange' : 'green');
        const statusLabel = pct >= 100 ? `${pct}% (Over budget!)` : `${pct}%`;

        return `
            <div class="budget-progress-item">
                <div class="budget-progress-header">
                    <span>${escapeHtml(getAccountName(key))}</span>
                    <span class="${textClass}">${spent.toLocaleString()}đ / ${limit.toLocaleString()}đ (${statusLabel})</span>
                </div>
                <div class="budget-bar-bg">
                    <div class="budget-bar-fill ${barClass}" style="width: ${barWidth}%;"></div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <hr style="margin: 15px 0; border: 0; border-top: 1px dashed var(--border-color);">
        <h3 class="section-subheading">MONTHLY BUDGETS:</h3>
        <div class="budget-progress-wrap">${itemsHtml}</div>
    `;
}

function getChartThemeColors() {
    const isDark = document.body.classList.contains('dark-mode');
    return {
        textColor: isDark ? '#c1cad4' : '#444444',
        gridColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'
    };
}

function renderChart(labels, data) {
    const canvas = document.getElementById('expenseChart');
    const emptyMsg = document.getElementById('chart-empty-msg');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (expenseChart) {
        expenseChart.destroy();
        expenseChart = null;
    }

    if (labels.length === 0) {
        canvas.style.display = 'none';
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    if (emptyMsg) emptyMsg.style.display = 'none';

    const { textColor } = getChartThemeColors();

    expenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#ff6384', '#36a2eb', '#cc65fe', '#ffce56', '#4bc0c0', '#f67019'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor }
                },
                title: {
                    display: true,
                    text: 'Expenditure allocation',
                    color: textColor
                }
            }
        }
    });
}

function renderTrendChart(endMonthKey) {
    const canvas = document.getElementById('trendChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    if (trendChart) {
        trendChart.destroy();
        trendChart = null;
    }

    const recentMonths = getRecentMonths(endMonthKey, 6);
    const labels = recentMonths.map(m => {
        const [y, mm] = m.split('-');
        return `${mm}/${y.slice(2)}`;
    });
    const incomeSeries = recentMonths.map(m => computeMonthlySummary(m).income);
    const expenseSeries = recentMonths.map(m => computeMonthlySummary(m).expense);

    const { textColor, gridColor } = getChartThemeColors();

    trendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Income',
                    data: incomeSeries,
                    backgroundColor: 'rgba(2, 117, 216, 0.75)',
                    borderRadius: 4
                },
                {
                    label: 'Spending',
                    data: expenseSeries,
                    backgroundColor: 'rgba(217, 83, 79, 0.75)',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: textColor },
                    grid: { color: gridColor }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: textColor,
                        callback: (value) => Number(value).toLocaleString() + 'đ'
                    },
                    grid: { color: gridColor }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor }
                }
            }
        }
    });
}

// Form submission (Add or Save Edit)
document.getElementById('finance-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const dateVal = document.getElementById('date-input').value;
    const monthKey = dateVal.slice(0, 7);
    const type = document.getElementById('transaction-type').value;
    const amount = parseFloat(document.getElementById('amount').value);
    const desc = document.getElementById('desc').value.trim();
    const accountId = document.getElementById('account-type-select').value;
    const liabilityId = document.getElementById('liability-account-select').value;
    const destinationId = document.getElementById('transfer-destination-select').value;
    const targetId = type === 'expense' ? liabilityId : (type === 'transfer' ? destinationId : '');
    const isRecurring = document.getElementById('is-recurring').checked;
    const frequency = document.getElementById('recurring-frequency').value;

    if (!dateVal || !desc) {
        alert('Please fill in all required fields.');
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        alert('Amount must be greater than 0.');
        return;
    }
    if (type === 'transfer' && accountId === targetId) {
        alert('The source and destination accounts must not be the same!');
        return;
    }

    if (editingState) {
        const oldMonth = editingState.monthKey;
        const oldIds = editingState.ids;
        allData[oldMonth] = (allData[oldMonth] || []).filter(t => !oldIds.includes(t.id));
        if (allData[oldMonth].length === 0) delete allData[oldMonth];
    }

    insertTransactionRecord({ dateVal, type, desc, amount, accountId, targetId });

    if (!editingState && isRecurring) {
        recurringRules.push({
            id: 'rec_' + nextUniqueId(),
            type,
            desc,
            accountId,
            targetId,
            amount,
            frequency,
            nextDate: advanceRecurringDate(dateVal, frequency)
        });
        localStorage.setItem('recurringRules', JSON.stringify(recurringRules));
    }

    localStorage.setItem('financeData', JSON.stringify(allData));
    monthFilter.value = monthKey;
    cancelEdit();
    renderRecurringList();
    renderUI();
});

// Excel Backup & Restore
function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        alert('Excel library failed to load. Please check your internet connection.');
        return;
    }

    const transactionRows = [];
    Object.keys(allData).sort().forEach(month => {
        const items = groupTransactionsForHistory(allData[month] || []);
        items.forEach(item => {
            transactionRows.push({
                Date: item.date,
                Type: item.txType,
                Description: item.desc,
                Account: getAccountName(item.accountId),
                Target: item.targetId ? getAccountName(item.targetId) : '',
                Amount: item.amount,
                AccountId: item.accountId,
                TargetId: item.targetId || ''
            });
        });
    });
    transactionRows.sort((a, b) => a.Date.localeCompare(b.Date));

    const accountRows = accountList.map(a => ({
        ID: a.id,
        Name: a.name,
        Type: a.type
    }));

    const budgetRows = Object.entries(budgetMap)
        .filter(([, limit]) => limit > 0)
        .map(([targetId, limit]) => ({
            TargetId: targetId,
            TargetName: getAccountName(targetId),
            Limit: limit
        }));

    const recurringRows = recurringRules.map(rule => ({
        ID: rule.id,
        Type: rule.type,
        Description: rule.desc,
        Account: getAccountName(rule.accountId),
        Target: rule.targetId ? getAccountName(rule.targetId) : '',
        Amount: rule.amount,
        Frequency: rule.frequency,
        NextDate: rule.nextDate,
        AccountId: rule.accountId,
        TargetId: rule.targetId || ''
    }));

    const wb = XLSX.utils.book_new();
    const txSheet = XLSX.utils.json_to_sheet(
        transactionRows.length > 0
            ? transactionRows
            : [{ Date: '', Type: '', Description: '', Account: '', Target: '', Amount: '', AccountId: '', TargetId: '' }]
    );
    txSheet['!cols'] = [
        { wch: 12 }, { wch: 10 }, { wch: 28 }, { wch: 18 },
        { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 18 }
    ];

    const accSheet = XLSX.utils.json_to_sheet(accountRows);
    accSheet['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 12 }];

    const budgetSheet = XLSX.utils.json_to_sheet(
        budgetRows.length > 0
            ? budgetRows
            : [{ TargetId: '', TargetName: '', Limit: '' }]
    );
    budgetSheet['!cols'] = [{ wch: 20 }, { wch: 24 }, { wch: 14 }];

    const recSheet = XLSX.utils.json_to_sheet(
        recurringRows.length > 0
            ? recurringRows
            : [{ ID: '', Type: '', Description: '', Account: '', Target: '', Amount: '', Frequency: '', NextDate: '', AccountId: '', TargetId: '' }]
    );
    recSheet['!cols'] = [
        { wch: 18 }, { wch: 10 }, { wch: 24 }, { wch: 18 },
        { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 18 }
    ];

    XLSX.utils.book_append_sheet(wb, txSheet, 'Transactions');
    XLSX.utils.book_append_sheet(wb, accSheet, 'Accounts');
    XLSX.utils.book_append_sheet(wb, budgetSheet, 'Budgets');
    XLSX.utils.book_append_sheet(wb, recSheet, 'Recurring');

    XLSX.writeFile(wb, `personal-finance-backup-${getLocalDateString()}.xlsx`);
}

function triggerImportExcel() {
    if (typeof XLSX === 'undefined') {
        alert('Excel library failed to load. Please check your internet connection.');
        return;
    }
    excelImportInput.value = '';
    excelImportInput.click();
}

function normalizeExcelDate(val) {
    if (typeof val === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF) {
        const parsed = XLSX.SSF.parse_date_code(val);
        if (parsed && parsed.y && parsed.m && parsed.d) {
            return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
        }
    }
    if (val instanceof Date && !isNaN(val.getTime())) {
        return getLocalDateString(val);
    }
    const str = String(val ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) {
        return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
    return '';
}

function resolveOrCreateAccount(accounts, idCandidate, nameCandidate, expectedType, seedRef) {
    if (idCandidate) {
        const byId = accounts.find(a => a.id === String(idCandidate).trim());
        if (byId) return byId;
    }
    const cleanName = String(nameCandidate ?? '').trim();
    if (cleanName) {
        const byName = accounts.find(
            a => a.name.trim().toLowerCase() === cleanName.toLowerCase() && (!expectedType || a.type === expectedType)
        );
        if (byName) return byName;

        const created = {
            id: idCandidate ? String(idCandidate).trim() : `acc_${seedRef.value++}`,
            name: cleanName,
            type: expectedType || 'asset'
        };
        accounts.push(created);
        return created;
    }
    return accounts.find(a => a.type === (expectedType || 'asset')) || null;
}

excelImportInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const hasTransactionsSheet = workbook.SheetNames.includes('Transactions');
            const hasAccountsSheet = workbook.SheetNames.includes('Accounts');
            if (!hasTransactionsSheet && !hasAccountsSheet) {
                alert('Invalid backup file: missing "Transactions" or "Accounts" sheet.');
                return;
            }

            let importedAccounts = [];
            if (hasAccountsSheet) {
                const rawAccounts = XLSX.utils.sheet_to_json(workbook.Sheets['Accounts'], { defval: '' });
                rawAccounts.forEach((row, idx) => {
                    const name = String(row.Name ?? '').trim();
                    const type = String(row.Type ?? '').trim().toLowerCase();
                    if (name && (type === 'asset' || type === 'liability')) {
                        importedAccounts.push({
                            id: String(row.ID || `acc_imp_${Date.now()}_${idx}`),
                            name,
                            type
                        });
                    }
                });
            }

            if (importedAccounts.length === 0) {
                importedAccounts = accountList.map(a => ({ ...a }));
            }

            const rawTxs = hasTransactionsSheet
                ? XLSX.utils.sheet_to_json(workbook.Sheets['Transactions'], { defval: '' })
                : [];
            const hasNonEmptyTxRow = rawTxs.some(
                row => String(row.Date ?? '').trim() !== '' ||
                    String(row.Amount ?? '').trim() !== '' ||
                    String(row.Description ?? '').trim() !== ''
            );

            const importedData = {};
            const seed = { value: Date.now() };
            let importedCount = 0;

            for (let i = 0; i < rawTxs.length; i++) {
                const row = rawTxs[i];
                const dateStr = normalizeExcelDate(row.Date);
                const txType = String(row.Type ?? '').trim().toLowerCase();
                const desc = String(row.Description ?? '').trim();
                const amount = parseFloat(row.Amount);

                if (!dateStr || !txType || isNaN(amount) || amount <= 0) continue;

                const monthKey = dateStr.slice(0, 7);
                if (!importedData[monthKey]) importedData[monthKey] = [];

                const baseId = seed.value;
                seed.value += 2;

                // Auto-merge legacy ungrouped [Chi] + [Phân loại] rows from older exports
                if (txType === 'expense' && desc.startsWith('[Chi] ') && !row.Target && !row.TargetId && i + 1 < rawTxs.length) {
                    const nextRow = rawTxs[i + 1];
                    const nextDate = normalizeExcelDate(nextRow.Date);
                    const nextType = String(nextRow.Type ?? '').trim().toLowerCase();
                    const nextDesc = String(nextRow.Description ?? '').trim();
                    const nextAmount = parseFloat(nextRow.Amount);
                    if (nextDate === dateStr && nextType === 'income' && nextAmount === amount && nextDesc.startsWith('[Phân loại] ')) {
                        const srcAcc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                        const catAcc = resolveOrCreateAccount(importedAccounts, nextRow.AccountId, nextRow.Account, 'liability', seed);
                        if (srcAcc && catAcc) {
                            const cleanDesc = desc.replace(/^\[Chi\]\s*/, '');
                            importedData[monthKey].push({
                                id: baseId, groupId: baseId, date: dateStr, desc: `[Expense] ${cleanDesc}`, amount, type: 'expense', account: srcAcc.id
                            });
                            importedData[monthKey].push({
                                id: baseId + 1, groupId: baseId, date: dateStr, desc: `[Type] ${cleanDesc}`, amount, type: 'income', account: catAcc.id
                            });
                            importedCount++;
                            i++;
                            continue;
                        }
                    }
                }

                if (txType === 'income') {
                    const acc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    if (!acc) return;
                    importedData[monthKey].push({
                        id: baseId, date: dateStr, desc: desc || 'Income', amount, type: 'income', account: acc.id
                    });
                    importedCount++;
                } else if (txType === 'expense') {
                    const srcAcc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    if (!srcAcc) continue;
                    const hasTarget = String(row.TargetId ?? '').trim() !== '' || String(row.Target ?? '').trim() !== '';
                    if (!hasTarget) {
                        importedData[monthKey].push({
                            id: baseId, date: dateStr, desc: desc || 'Expense', amount, type: 'expense', account: srcAcc.id
                        });
                    } else {
                        const catAcc = resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'liability', seed);
                        if (!catAcc) continue;
                        importedData[monthKey].push({
                            id: baseId, groupId: baseId, date: dateStr, desc: `[Expense] ${desc || 'Expense'}`, amount, type: 'expense', account: srcAcc.id
                        });
                        importedData[monthKey].push({
                            id: baseId + 1, groupId: baseId, date: dateStr, desc: `[Type] ${desc || 'Expense'}`, amount, type: 'income', account: catAcc.id
                        });
                    }
                    importedCount++;
                } else if (txType === 'transfer') {
                    const srcAcc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    const destAcc = resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'asset', seed);
                    if (!srcAcc || !destAcc || srcAcc.id === destAcc.id) continue;
                    importedData[monthKey].push({
                        id: baseId, groupId: baseId, date: dateStr, desc: `[Move] ${desc || 'Transfer'} (To ${destAcc.name})`, amount, type: 'transfer_out', account: srcAcc.id
                    });
                    importedData[monthKey].push({
                        id: baseId + 1, groupId: baseId, date: dateStr, desc: `[Get from] ${desc || 'Transfer'} (From ${srcAcc.name})`, amount, type: 'transfer_in', account: destAcc.id
                    });
                    importedCount++;
                } else if (txType === 'transfer_out' || txType === 'transfer_in') {
                    const acc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    if (!acc) continue;
                    importedData[monthKey].push({
                        id: baseId, date: dateStr, desc: desc || 'Transfer', amount, type: txType, account: acc.id
                    });
                    importedCount++;
                }
            }

            if (hasNonEmptyTxRow && importedCount === 0) {
                alert('No valid transactions found in the "Transactions" sheet.');
                return;
            }

            let importedBudgets = null;
            if (workbook.SheetNames.includes('Budgets')) {
                importedBudgets = {};
                const rawBudgets = XLSX.utils.sheet_to_json(workbook.Sheets['Budgets'], { defval: '' });
                rawBudgets.forEach(row => {
                    const limit = parseFloat(row.Limit);
                    if (isNaN(limit) || limit <= 0) return;
                    const rawId = String(row.TargetId ?? '').trim();
                    if (rawId === OVERALL_BUDGET_KEY) {
                        importedBudgets[OVERALL_BUDGET_KEY] = limit;
                        return;
                    }
                    const acc = resolveOrCreateAccount(importedAccounts, rawId, row.TargetName, 'liability', seed);
                    if (acc) importedBudgets[acc.id] = limit;
                });
            }

            let importedRecurring = null;
            if (workbook.SheetNames.includes('Recurring')) {
                importedRecurring = [];
                const rawRecurring = XLSX.utils.sheet_to_json(workbook.Sheets['Recurring'], { defval: '' });
                const validFreqs = ['daily', 'weekly', 'monthly', 'yearly'];
                rawRecurring.forEach((row, idx) => {
                    const txType = String(row.Type ?? '').trim().toLowerCase();
                    const desc = String(row.Description ?? '').trim();
                    const amount = parseFloat(row.Amount);
                    const frequency = String(row.Frequency ?? '').trim().toLowerCase();
                    const nextDate = normalizeExcelDate(row.NextDate) || getLocalDateString();
                    if (!desc || isNaN(amount) || amount <= 0 || !validFreqs.includes(frequency)) return;

                    if (txType === 'income') {
                        const acc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                        if (acc) importedRecurring.push({ id: String(row.ID || `rec_imp_${Date.now()}_${idx}`), type: 'income', desc, accountId: acc.id, targetId: '', amount, frequency, nextDate });
                    } else if (txType === 'expense') {
                        const src = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                        const cat = resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'liability', seed);
                        if (src && cat) importedRecurring.push({ id: String(row.ID || `rec_imp_${Date.now()}_${idx}`), type: 'expense', desc, accountId: src.id, targetId: cat.id, amount, frequency, nextDate });
                    } else if (txType === 'transfer') {
                        const src = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                        const dest = resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'asset', seed);
                        if (src && dest && src.id !== dest.id) importedRecurring.push({ id: String(row.ID || `rec_imp_${Date.now()}_${idx}`), type: 'transfer', desc, accountId: src.id, targetId: dest.id, amount, frequency, nextDate });
                    }
                });
            }

            if (!confirm(`Restore ${importedCount} transaction(s) and ${importedAccounts.length} account(s) from Excel? This will replace your current data.`)) {
                return;
            }

            accountList = importedAccounts;
            allData = importedData;
            localStorage.setItem('accountList', JSON.stringify(accountList));
            localStorage.setItem('financeData', JSON.stringify(allData));

            if (importedBudgets !== null) {
                budgetMap = importedBudgets;
                localStorage.setItem('budgetMap', JSON.stringify(budgetMap));
            }
            if (importedRecurring !== null) {
                recurringRules = importedRecurring;
                localStorage.setItem('recurringRules', JSON.stringify(recurringRules));
            }

            cancelEdit();

            const months = Object.keys(allData).sort();
            if (months.length > 0 && !allData[monthFilter.value]) {
                monthFilter.value = months[months.length - 1];
            }

            initApp();
            alert('Data restored successfully from Excel!');
        } catch (err) {
            console.error(err);
            alert('Failed to read the Excel file. Please make sure it is a valid .xlsx/.xls backup file.');
        }
    };
    reader.readAsArrayBuffer(file);
});

monthFilter.addEventListener('change', renderUI);
historySearchInput.addEventListener('input', renderUI);
historyTypeFilter.addEventListener('change', renderUI);

window.onload = function() {
    applySavedTheme();
    initApp();
    toggleAccountSelect();
};
