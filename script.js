// --- KHỞI TẠO DỮ LIỆU ---
let accountList = JSON.parse(localStorage.getItem('accountList')) || [
    { name: 'Cash', type: 'asset', id: 'cash' },
    { name: 'Bank', type: 'asset', id: 'bank' },
    { name: 'General', type: 'liability', id: 'general_exp' }
];

let allData = JSON.parse(localStorage.getItem('financeData')) || {};
let expenseChart = null; 

const dateInput = document.getElementById('date-input');
const monthFilter = document.getElementById('month-filter');
const today = new Date().toISOString().split('T')[0];

dateInput.value = today;
if (!monthFilter.value) monthFilter.value = today.slice(0, 7);

// --- QUẢN LÝ TÀI KHOẢN ---
function addAccountType() {
    const nameInput = document.getElementById('new-account-name');
    const typeInput = document.getElementById('new-account-type');
    if (!nameInput.value) return;
    
    const newAcc = { name: nameInput.value, type: typeInput.value, id: 'acc_' + Date.now() };
    accountList.push(newAcc);
    localStorage.setItem('accountList', JSON.stringify(accountList));
    nameInput.value = '';
    initApp();
}

function deleteAccount(id) {
    if (confirm("Delete this account?")) {
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
        label.innerText = "Withdraw from (Original account):";
        liabilityGroup.style.display = "block";
        transferContainer.style.display = "none";
    } else if (type === 'transfer') {
        label.innerText = "From (Source Account):";
        liabilityGroup.style.display = "none";
        transferContainer.style.display = "block";
    } else {
        label.innerText = "To (Account):";
        liabilityGroup.style.display = "none";
        transferContainer.style.display = "none";
    }
}

function deleteTransaction(monthKey, transactionId) {
    if (confirm("Are you sure you want to delete this transaction?")) {
        allData[monthKey] = allData[monthKey].filter(t => t.id !== transactionId);
        if (allData[monthKey].length === 0) delete allData[monthKey];
        localStorage.setItem('financeData', JSON.stringify(allData));
        renderUI();
    }
}

// --- KHỞI TẠO APP ---
function initApp() {
    const assetSelect = document.getElementById('account-type-select');
    const liabilitySelect = document.getElementById('liability-account-select');
    const transferSelect = document.getElementById('transfer-destination-select'); 
    
    const assetOptions = accountList.filter(a => a.type === 'asset')
        .map(a => `<option value="${a.id}">${a.name}</option>`).join('');

    assetSelect.innerHTML = assetOptions;
    if (transferSelect) transferSelect.innerHTML = assetOptions; 

    liabilitySelect.innerHTML = accountList.filter(a => a.type === 'liability')
        .map(a => `<option value="${a.id}">${a.name}</option>`).join('');

    const manageList = document.getElementById('account-list-manage');
    manageList.innerHTML = accountList.map(a => `
        <li>
            <span>${a.name} <strong>(${a.type === 'asset' ? 'Asset' : 'Liability'})</strong></span>
            <button onclick="deleteAccount('${a.id}')" class="btn-del-mini">✖</button>
        </li>
    `).join('');

    renderUI();
}

// HIỂN THỊ 
function renderUI() {
    const selectedMonth = monthFilter.value;
    const transactionsInMonth = allData[selectedMonth] || [];
    
    // LỊCH SỬ GIAO DỊCH
    const listEl = document.getElementById('transaction-list');
    listEl.innerHTML = transactionsInMonth.map((t) => {
        const acc = accountList.find(a => a.id === t.account);
        const accName = acc ? acc.name : 'N/A';
        
        let colorClass = 'blue';
        let sign = '+';
        if (t.type === 'expense') { colorClass = 'red'; sign = '-'; }
        if (t.type === 'transfer_out') { colorClass = 'orange'; sign = '-'; }
        if (t.type === 'transfer_in') { colorClass = 'orange'; sign = '+'; }

        return `
            <li>
                <div>
                    <small style="color: #999;">${t.date.split('-')[2]}/${t.date.split('-')[1]}</small><br>
                    <strong>${t.desc}</strong><br>
                    <span class="account-tag">💳 ${accName}</span>
                </div>
                <div style="text-align: right;">
                    <span class="${colorClass}">
                        ${sign}${t.amount.toLocaleString()}đ
                    </span>
                    <button onclick="deleteTransaction('${selectedMonth}', ${t.id})" class="btn-del-mini" style="margin-left: 10px;">✕</button>
                </div>
            </li>
        `;
    }).reverse().join('');

    //  SỐ DƯ & DÒNG TIỀN
    let monthlyFlow = { income: 0, expense: 0 }; 
    let totalBalances = {}; 
    let monthlyExpenseDetails = {}; 

    accountList.forEach(a => {
        totalBalances[a.id] = 0;
        if (a.type === 'liability') monthlyExpenseDetails[a.id] = 0;
    });

    Object.keys(allData).forEach(month => {
        allData[month].forEach(t => {
            if (totalBalances.hasOwnProperty(t.account)) {
                const accInfo = accountList.find(a => a.id === t.account);
                
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
            }
        });
    });

    // BIỂU ĐỒ 
    const chartLabels = [];
    const chartData = [];
    accountList.forEach(a => {
        if (a.type === 'liability' && monthlyExpenseDetails[a.id] > 0) {
            chartLabels.push(a.name);
            chartData.push(monthlyExpenseDetails[a.id]);
        }
    });
    renderChart(chartLabels, chartData);

    //  BÁO CÁO TÀI CHÍNH
    const reportEl = document.getElementById('balance-sheet-content');
    document.getElementById('current-view-title').innerText = `Monthly report ${selectedMonth.split('-')[1]}/${selectedMonth.split('-')[0]}`;
    
    let htmlContent = `
        <div class="row"><span>Monthly income:</span> <b class="blue">+${monthlyFlow.income.toLocaleString()}đ</b></div>
        <div class="row"><span>Monthly spending:</span> <b class="red">-${monthlyFlow.expense.toLocaleString()}đ</b></div>
        <hr style="margin: 15px 0; border: 0; border-top: 1px dashed #ccc;">
        <h3 style="font-size: 0.8em; margin-bottom: 10px; color: #444;">CURRENT ASSETS:</h3>
    `;

    let netWorth = 0;
    accountList.forEach(a => {
        if (a.type === 'asset') {
            const balance = totalBalances[a.id] || 0;
            htmlContent += `<div class="row sub-row"><span>${a.name}</span> <span>${balance.toLocaleString()}đ</span></div>`;
            netWorth += balance;
        }
    });

    reportEl.innerHTML = htmlContent;
    document.getElementById('total-sum').innerText = netWorth.toLocaleString() + 'đ';
}

function renderChart(labels, data) {
    const canvas = document.getElementById('expenseChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (expenseChart) {
        expenseChart.destroy();
    }

    if (labels.length === 0) {
        return;
    }

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

// XỬ LÝ FORM 
document.getElementById('finance-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const dateVal = document.getElementById('date-input').value;
    const monthKey = dateVal.slice(0, 7);
    const type = document.getElementById('transaction-type').value;
    const amount = parseFloat(document.getElementById('amount').value);
    const desc = document.getElementById('desc').value;
    const assetId = document.getElementById('account-type-select').value;
    const liabilityId = document.getElementById('liability-account-select').value;
    const destinationId = document.getElementById('transfer-destination-select').value; 

    if (!allData[monthKey]) allData[monthKey] = [];

    const now = Date.now();
    if (type === 'income') {
        allData[monthKey].push({ id: now, date: dateVal, desc: desc, amount: amount, type: 'income', account: assetId });
    } else if (type === 'expense') {
        allData[monthKey].push({ id: now, date: dateVal, desc: `[Chi] ${desc}`, amount: amount, type: 'expense', account: assetId });
        allData[monthKey].push({ id: now + 1, date: dateVal, desc: `[Phân loại] ${desc}`, amount: amount, type: 'income', account: liabilityId });
    } else if (type === 'transfer') {
        if (assetId === destinationId) {
            alert("The source and destination accounts must not be the same!");
            return;
        }
        const srcAcc = accountList.find(a => a.id === assetId)?.name || '';
        const destAcc = accountList.find(a => a.id === destinationId)?.name || '';

        allData[monthKey].push({ id: now, date: dateVal, desc: `[Move] ${desc} (To ${destAcc})`, amount: amount, type: 'transfer_out', account: assetId });
        allData[monthKey].push({ id: now + 1, date: dateVal, desc: `[Get from] ${desc} (From ${srcAcc})`, amount: amount, type: 'transfer_in', account: destinationId });
    }

    localStorage.setItem('financeData', JSON.stringify(allData));
    this.reset();
    document.getElementById('date-input').value = today;
    monthFilter.value = monthKey; 
    toggleAccountSelect(); 
    renderUI();
});

monthFilter.addEventListener('change', renderUI);
window.onload = function() {
    initApp();
    toggleAccountSelect(); // Đảm bảo nhãn và giao diện khớp với lựa chọn mặc định ban đầu
};
