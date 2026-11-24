// Initial state
let accountList = JSON.parse(localStorage.getItem('accountList')) || [
    { name: 'Cash', type: 'asset', id: 'cash' },
    { name: 'Bank', type: 'asset', id: 'bank' },
    { name: 'General', type: 'liability', id: 'general_exp' }
];

let allData = JSON.parse(localStorage.getItem('financeData')) || {};
let expenseChart = null;
let editingState = null; // { monthKey, ids }

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
    const acc = accountList.find(a => a.id === id);
    return acc ? acc.name : 'N/A';
}

function getSelectedMonth() {
    if (!monthFilter.value) {
        monthFilter.value = getLocalDateString().slice(0, 7);
    }
    return monthFilter.value;
}

// Account management
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

function deleteAccount(id) {
    const targetAcc = accountList.find(a => a.id === id);
    if (!targetAcc) return;

    const sameTypeCount = accountList.filter(a => a.type === targetAcc.type).length;
    if (sameTypeCount <= 1) {
        alert(`You must keep at least one ${targetAcc.type === 'asset' ? 'Asset' : 'Expense'} account.`);
        return;
    }

    const isUsed = Object.values(allData).some(
        monthTxs => Array.isArray(monthTxs) && monthTxs.some(t => t.account === id)
    );
    if (isUsed) {
        alert('Cannot delete this account because it is used in existing transactions. Please edit or delete those transactions first.');
        return;
    }

    if (confirm('Delete this account?')) {
        accountList = accountList.filter(a => a.id !== id);
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
                next.desc.startsWith('[Type] ');
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
                    desc: exp.desc.replace(/^\[Expense\]\s*/, ''),
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
        const dateCmp = b.date.localeCompare(a.date);
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
    document.getElementById('submit-btn').innerText = 'Save changes';
    document.getElementById('cancel-edit-btn').style.display = 'inline-block';

    document.getElementById('finance-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelEdit() {
    editingState = null;
    document.getElementById('finance-form').reset();
    dateInput.value = getLocalDateString();
    document.getElementById('edit-banner').style.display = 'none';
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

    const manageList = document.getElementById('account-list-manage');
    manageList.innerHTML = accountList.map(a => `
        <li>
            <span>${escapeHtml(a.name)} <strong>(${a.type === 'asset' ? 'Asset' : 'Expense'})</strong></span>
            <button type="button" onclick="deleteAccount('${escapeHtml(a.id)}')" class="btn-del-mini" title="Delete account">✖</button>
        </li>
    `).join('');

    renderUI();
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
            const [, month, day] = item.date.split('-');
            const idListArg = `[${item.ids.join(',')}]`;
            const canEdit = item.txType === 'income' || item.txType === 'expense' || item.txType === 'transfer';

            return `
                <li>
                    <div>
                        <small style="color: #999;">${escapeHtml(day)}/${escapeHtml(month)}</small><br>
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

    // Cash flow & balances
    const monthlyFlow = { income: 0, expense: 0 };
    const totalBalances = {};
    const monthlyExpenseDetails = {};

    accountList.forEach(a => {
        totalBalances[a.id] = 0;
        if (a.type === 'liability') monthlyExpenseDetails[a.id] = 0;
    });

    Object.keys(allData).forEach(month => {
        (allData[month] || []).forEach(t => {
            const accInfo = accountList.find(a => a.id === t.account);
            if (!accInfo) return;

            if (t.type === 'income' || t.type === 'transfer_in') {
                totalBalances[t.account] += t.amount;
                if (month === selectedMonth && t.type === 'income') {
                    if (accInfo.type === 'asset') monthlyFlow.income += t.amount;
                    if (accInfo.type === 'liability') monthlyExpenseDetails[t.account] += t.amount;
                }
            } else if (t.type === 'expense' || t.type === 'transfer_out') {
                totalBalances[t.account] -= t.amount;
                if (month === selectedMonth && t.type === 'expense') {
                    monthlyFlow.expense += t.amount;
                }
            }
        });
    });

    // Expenditure allocation chart
    const chartLabels = [];
    const chartData = [];
    accountList.forEach(a => {
        if (a.type === 'liability' && monthlyExpenseDetails[a.id] > 0) {
            chartLabels.push(a.name);
            chartData.push(monthlyExpenseDetails[a.id]);
        }
    });
    renderChart(chartLabels, chartData);

    // Monthly financial report
    const reportEl = document.getElementById('balance-sheet-content');
    const [yearPart, monthPart] = selectedMonth.split('-');
    document.getElementById('current-view-title').innerText = `Monthly report ${monthPart}/${yearPart}`;

    const netCashflow = monthlyFlow.income - monthlyFlow.expense;
    const netSign = netCashflow >= 0 ? '+' : '-';
    const netClass = netCashflow >= 0 ? 'blue' : 'red';

    let htmlContent = `
        <div class="row"><span>Monthly income:</span> <b class="blue">+${monthlyFlow.income.toLocaleString()}đ</b></div>
        <div class="row"><span>Monthly spending:</span> <b class="red">-${monthlyFlow.expense.toLocaleString()}đ</b></div>
        <div class="row"><span>Monthly net cashflow:</span> <b class="${netClass}">${netSign}${Math.abs(netCashflow).toLocaleString()}đ</b></div>
        <hr style="margin: 15px 0; border: 0; border-top: 1px dashed #ccc;">
        <h3 style="font-size: 0.8em; margin-bottom: 10px; color: #444;">CURRENT ASSETS:</h3>
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
    document.getElementById('total-sum').innerText = netWorth.toLocaleString() + 'đ';
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
                legend: { position: 'bottom' },
                title: { display: true, text: 'Expenditure allocation' }
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
    const assetId = document.getElementById('account-type-select').value;
    const liabilityId = document.getElementById('liability-account-select').value;
    const destinationId = document.getElementById('transfer-destination-select').value;

    if (!dateVal || !desc) {
        alert('Please fill in all required fields.');
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        alert('Amount must be greater than 0.');
        return;
    }
    if (type === 'transfer' && assetId === destinationId) {
        alert('The source and destination accounts must not be the same!');
        return;
    }

    if (editingState) {
        const oldMonth = editingState.monthKey;
        const oldIds = editingState.ids;
        allData[oldMonth] = (allData[oldMonth] || []).filter(t => !oldIds.includes(t.id));
        if (allData[oldMonth].length === 0) delete allData[oldMonth];
    }

    if (!allData[monthKey]) allData[monthKey] = [];

    const now = Date.now();
    if (type === 'income') {
        allData[monthKey].push({ id: now, date: dateVal, desc, amount, type: 'income', account: assetId });
    } else if (type === 'expense') {
        allData[monthKey].push({ id: now, groupId: now, date: dateVal, desc: `[Expense] ${desc}`, amount, type: 'expense', account: assetId });
        allData[monthKey].push({ id: now + 1, groupId: now, date: dateVal, desc: `[Type] ${desc}`, amount, type: 'income', account: liabilityId });
    } else if (type === 'transfer') {
        const srcAcc = getAccountName(assetId);
        const destAcc = getAccountName(destinationId);

        allData[monthKey].push({ id: now, groupId: now, date: dateVal, desc: `[Move] ${desc} (To ${destAcc})`, amount, type: 'transfer_out', account: assetId });
        allData[monthKey].push({ id: now + 1, groupId: now, date: dateVal, desc: `[Get from] ${desc} (From ${srcAcc})`, amount, type: 'transfer_in', account: destinationId });
    }

    localStorage.setItem('financeData', JSON.stringify(allData));
    monthFilter.value = monthKey;
    cancelEdit();
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

    XLSX.utils.book_append_sheet(wb, txSheet, 'Transactions');
    XLSX.utils.book_append_sheet(wb, accSheet, 'Accounts');

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
            let seed = { value: Date.now() };
            let importedCount = 0;

            rawTxs.forEach(row => {
                const dateStr = normalizeExcelDate(row.Date);
                const txType = String(row.Type ?? '').trim().toLowerCase();
                const desc = String(row.Description ?? '').trim();
                const amount = parseFloat(row.Amount);

                if (!dateStr || !txType || isNaN(amount) || amount <= 0) return;

                const monthKey = dateStr.slice(0, 7);
                if (!importedData[monthKey]) importedData[monthKey] = [];

                const baseId = seed.value;
                seed.value += 2;

                if (txType === 'income') {
                    const acc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    if (!acc) return;
                    importedData[monthKey].push({
                        id: baseId, date: dateStr, desc: desc || 'Income', amount, type: 'income', account: acc.id
                    });
                    importedCount++;
                } else if (txType === 'expense') {
                    const srcAcc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    const catAcc = resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'liability', seed);
                    if (!srcAcc || !catAcc) return;
                    importedData[monthKey].push({
                        id: baseId, groupId: baseId, date: dateStr, desc: `[Expense] ${desc || 'Expense'}`, amount, type: 'expense', account: srcAcc.id
                    });
                    importedData[monthKey].push({
                        id: baseId + 1, groupId: baseId, date: dateStr, desc: `[Type] ${desc || 'Expense'}`, amount, type: 'income', account: catAcc.id
                    });
                    importedCount++;
                } else if (txType === 'transfer') {
                    const srcAcc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    const destAcc = resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'asset', seed);
                    if (!srcAcc || !destAcc || srcAcc.id === destAcc.id) return;
                    importedData[monthKey].push({
                        id: baseId, groupId: baseId, date: dateStr, desc: `[Move] ${desc || 'Transfer'} (To ${destAcc.name})`, amount, type: 'transfer_out', account: srcAcc.id
                    });
                    importedData[monthKey].push({
                        id: baseId + 1, groupId: baseId, date: dateStr, desc: `[Get from] ${desc || 'Transfer'} (From ${srcAcc.name})`, amount, type: 'transfer_in', account: destAcc.id
                    });
                    importedCount++;
                } else if (txType === 'transfer_out' || txType === 'transfer_in') {
                    const acc = resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    if (!acc) return;
                    importedData[monthKey].push({
                        id: baseId, date: dateStr, desc: desc || 'Transfer', amount, type: txType, account: acc.id
                    });
                    importedCount++;
                }
            });

            if (hasNonEmptyTxRow && importedCount === 0) {
                alert('No valid transactions found in the "Transactions" sheet.');
                return;
            }

            if (!confirm(`Restore ${importedCount} transaction(s) and ${importedAccounts.length} account(s) from Excel? This will replace your current data.`)) {
                return;
            }

            accountList = importedAccounts;
            allData = importedData;
            localStorage.setItem('accountList', JSON.stringify(accountList));
            localStorage.setItem('financeData', JSON.stringify(allData));
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
    initApp();
    toggleAccountSelect();
};
