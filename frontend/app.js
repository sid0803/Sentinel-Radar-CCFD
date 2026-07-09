// CCFD Radar - Enterprise Platform Javascript Client

// Global state variables
let presetsData = null;
let statsData = null;
let currentPredictionData = null;
let historyLog = [];
let currentThreshold = 0.5;
let apiKeyInput = null;

// Auth helper
function getAuthHeaders() {
    const key = localStorage.getItem('sentinel_api_key') || 'sentinel_dev_key_2026';
    return {
        'Content-Type': 'application/json',
        'X-API-Key': key
    };
}

// Chart instances
let shapChartInstance = null;
let rocChartInstance = null;
let prChartInstance = null;
let importanceChartInstance = null;
let dbTrendChartInstance = null;
let dbVerdictChartInstance = null;
let dbAmountChartInstance = null;

// DOM Elements
let slidersColLeft = null;
let slidersColRight = null;
let pcaToggle = null;
let pcaSection = null;

let analyzerForm = null;
let submitBtn = null;
let resetBtn = null;
let randomizeBtn = null;
let btnSpinner = null;

let inputCardholder = null;
let inputCardNumber = null;
let inputTime = null;
let inputAmount = null;
let inputMerchant = null;
let inputCategory = null;
let inputCountry = null;
let inputDevice = null;
let timeHelper = null;

let cardDisplayNumber = null;
let cardDisplayName = null;

let verdictSection = null;
let verdictBannerCard = null;
let ensembleBadge = null;
let ensembleVerdictTitle = null;
let ensembleConfidencePercent = null;
let ensembleVotes = null;
let riskThermometerBar = null;
let riskValueText = null;

let gaugeRf = null;
let gaugeXgb = null;
let gaugeLgbm = null;
let gaugeValRf = null;
let gaugeValXgb = null;
let gaugeValLgbm = null;
let badgeRf = null;
let badgeXgb = null;
let badgeLgbm = null;

let shapSection = null;
let shapModelSelect = null;
let shapSummaryText = null;

let metricsTableBody = null;
let importanceModelSelect = null;

// Sidebar link navigation controls
let sidebarLinks = null;
let viewPanels = null;
let pageTitle = null;

// Top bar stats
let pillAnalyzed = null;
let pillFlagged = null;
let pillFraudRate = null;

// Dashboard metrics
let dbSessionRate = null;
let dbSessionFlaggedText = null;
let dbActivityBody = null;
let dashboardGoQueue = null;

// Review Queue elements
let queueRefreshBtn = null;
let clearHistoryBtn = null;
let queueSearchInput = null;
let queueFilterVerdict = null;
let queueTableBody = null;

// API documentation copy buttons
let btnCopyCurl = null;
let btnCopyJson = null;

// ─────────────────────────────────────────────────────────────────────────────
// Toast Notification Utility
// ─────────────────────────────────────────────────────────────────────────────
function escapeHTML(str) {
    if (!str) return '';
    return str.toString().replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'danger') iconClass = 'fa-circle-xmark';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    // HTML escape message to prevent XSS (C-01)
    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <div class="toast-body">${escapeHTML(message)}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}


// ─────────────────────────────────────────────────────────────────────────────
// 1. App Shell View Switching
// ─────────────────────────────────────────────────────────────────────────────
function switchView(targetViewId) {
    // Deactivate all links and panels
    sidebarLinks.forEach(link => link.classList.remove('active'));
    viewPanels.forEach(panel => panel.classList.remove('active-view'));

    // Find and activate match
    const activeLink = Array.from(sidebarLinks).find(link => link.getAttribute('data-view') === targetViewId);
    const activePanel = document.getElementById(targetViewId);

    if (activeLink) activeLink.classList.add('active');
    if (activePanel) activePanel.classList.add('active-view');

    // Update Topbar Title
    let titleText = "Dashboard Overview";
    if (targetViewId === 'analyzer-view') titleText = "Analyze Transaction";
    if (targetViewId === 'performance-view') titleText = "Model Performance Analytics";
    if (targetViewId === 'queue-view') titleText = "Session Review Queue";
    if (targetViewId === 'api-view') titleText = "Developer API Reference Docs";
    pageTitle.textContent = titleText;

    // Trigger loads if relevant
    if (targetViewId === 'dashboard-view') {
        loadSessionStats();
        loadHistoryQueue();
    } else if (targetViewId === 'queue-view') {
        loadHistoryQueue();
    }
}

// Bind sidebar buttons and interactive inputs are now safe-bound in bindAllEvents() inside DOMContentLoaded

// ─────────────────────────────────────────────────────────────────────────────
// 3. Initialize PCA Feature Sliders
// ─────────────────────────────────────────────────────────────────────────────
function initSliders() {
    slidersColLeft.innerHTML = '';
    slidersColRight.innerHTML = '';

    for (let i = 1; i <= 28; i++) {
        const sliderGroup = document.createElement('div');
        sliderGroup.className = 'slider-group';
        sliderGroup.innerHTML = `
            <span class="slider-name">V${i}</span>
            <div class="slider-input-wrapper">
                <input type="range" id="slider-v${i}" min="-20" max="20" step="0.01" value="0">
            </div>
            <span class="slider-val" id="val-v${i}">0.00</span>
        `;

        if (i <= 14) {
            slidersColLeft.appendChild(sliderGroup);
        } else {
            slidersColRight.appendChild(sliderGroup);
        }

        const sliderInput = sliderGroup.querySelector('input');
        const sliderValDisplay = sliderGroup.querySelector('.slider-val');
        sliderInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value).toFixed(2);
            sliderValDisplay.textContent = val;
            clearActivePresets();
        });
    }
    
    // Time input conversion listener
    if (inputTime) {
        inputTime.addEventListener('input', (e) => {
            updateTimeHelper(parseInt(e.target.value, 10));
        });
        updateTimeHelper(parseInt(inputTime.value, 10));
    }
}

// Collapsible advanced accordion toggle is safe-bound inside DOMContentLoaded

function clearActivePresets() {
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.classList.remove('active');
    });
}

function setFormValues(params) {
    if (params.Amount !== undefined) inputAmount.value = parseFloat(params.Amount).toFixed(2);
    if (params.Time !== undefined) {
        inputTime.value = params.Time;
        updateTimeHelper(params.Time);
    }
    
    // Mock metadata mapping for standard preset objects
    if (params.Cardholder) {
        inputCardholder.value = params.Cardholder;
        cardDisplayName.textContent = params.Cardholder.toUpperCase();
    } else {
        inputCardholder.value = "John Doe";
        cardDisplayName.textContent = "JOHN DOE";
    }

    if (params.Card_Number) {
        inputCardNumber.value = params.Card_Number;
        const shortNum = params.Card_Number.replace(/\s+/g, '');
        cardDisplayNumber.textContent = '•••• •••• •••• ' + shortNum.substring(shortNum.length - 4);
    } else {
        inputCardNumber.value = "4242 4242 4242 4242";
        cardDisplayNumber.textContent = "•••• •••• •••• 4242";
    }

    inputMerchant.value = params.Merchant || "Amazon Web Services";
    inputCategory.value = params.Category || "Online Retail";
    inputCountry.value = params.Country || "United States";
    inputDevice.value = params.Device || "Mobile App";

    // Set PCA sliders
    for (let i = 1; i <= 28; i++) {
        const featureKey = `V${i}`;
        if (params[featureKey] !== undefined) {
            const slider = document.getElementById(`slider-v${i}`);
            const display = document.getElementById(`val-v${i}`);
            if (slider && display) {
                slider.value = params[featureKey];
                display.textContent = parseFloat(params[featureKey]).toFixed(2);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Scenario Presets
// ─────────────────────────────────────────────────────────────────────────────
async function loadPresets() {
    try {
        const res = await fetch('/api/presets', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error("Could not load scenarios preset data");
        presetsData = await res.json();
        
        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const type = btn.getAttribute('data-type');
                const index = parseInt(btn.getAttribute('data-index'), 10);
                
                if (presetsData && presetsData[type] && presetsData[type][index]) {
                    clearActivePresets();
                    btn.classList.add('active');
                    
                    // Enrich standard flat preset object with realistic metadata
                    const presetObj = { ...presetsData[type][index] };
                    if (type === 'fraud') {
                        presetObj.Cardholder = ["Alice Smith", "Marcus Vance", "Carlos Mendez"][index] || "Fraud Suspect";
                        presetObj.Card_Number = ["4829 4802 1294 8820", "5520 1829 4920 1192", "4112 0492 1829 4029"][index] || "4242 4242 4242 8829";
                        presetObj.Merchant = ["Unknown Electronics Store", "Cryptocurrency Exchange Co.", "High-End Luxury Watch Broker"][index] || "Overseas Retailer";
                        presetObj.Category = ["Online Retail", "Services & Support", "Travel & Transportation"][index] || "Online Retail";
                        presetObj.Country = ["France", "Germany", "Japan"][index] || "United Kingdom";
                        presetObj.Device = ["Automated API", "Web Browser", "Mobile App"][index] || "Web Browser";
                    } else {
                        presetObj.Cardholder = ["John Doe", "Sarah Jenkins", "Robert Chen"][index] || "Legit Customer";
                        presetObj.Card_Number = ["4242 4242 4242 4242", "4532 9842 1092 8830", "5291 0029 1928 4402"][index] || "4242 4242 4242 4242";
                        presetObj.Merchant = ["Amazon Web Services", "Local Supermarket Inc.", "Starbucks Coffee Shop"][index] || "Google Play Store";
                        presetObj.Category = ["Online Retail", "Food & Dining", "Food & Dining"][index] || "Online Retail";
                        presetObj.Country = ["United States", "United States", "Australia"][index] || "United States";
                        presetObj.Device = ["Mobile App", "POS Terminal", "Mobile App"][index] || "Mobile App";
                    }
                    
                    setFormValues(presetObj);
                }
            });
        });
    } catch (err) {
        console.error("Presets load failure:", err);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction submit, reset, and randomize event handlers are now safe-bound in bindAllEvents() inside DOMContentLoaded

// ─────────────────────────────────────────────────────────────────────────────
// 6. Render Verdict & Breakdown Dashboard
// ─────────────────────────────────────────────────────────────────────────────
function renderVerdict(data, inputParams) {
    verdictSection.classList.remove('hidden');
    verdictSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Update Transaction Summary Card
    if (inputParams) {
        document.getElementById('summary-amount').textContent = `$${parseFloat(inputParams.Amount).toFixed(2)}`;
        
        const secondsVal = parseInt(inputParams.Time, 10);
        const hours = Math.floor(secondsVal / 3600);
        const minutes = Math.floor((secondsVal % 3600) / 60);
        const seconds = secondsVal % 60;
        let timeString = [];
        if (hours > 0) timeString.push(`${hours}h`);
        if (minutes > 0) timeString.push(`${minutes}m`);
        if (seconds > 0 || timeString.length === 0) timeString.push(`${seconds}s`);
        document.getElementById('summary-time').textContent = timeString.join(' ') + ' elapsed';

        const extremePcas = [];
        for (let i = 1; i <= 28; i++) {
            extremePcas.push({ name: `V${i}`, val: inputParams[`V${i}`] || 0 });
        }
        extremePcas.sort((a, b) => Math.abs(b.val) - Math.abs(a.val));
        const top3 = extremePcas.slice(0, 3);
        
        const extremePcaContainer = document.getElementById('summary-extreme-pca');
        extremePcaContainer.innerHTML = '';
        top3.forEach(item => {
            const badge = document.createElement('span');
            badge.className = `pca-badge ${item.val >= 0 ? 'positive' : 'negative'}`;
            badge.textContent = `${item.name}: ${item.val >= 0 ? '+' : ''}${parseFloat(item.val).toFixed(2)}`;
            extremePcaContainer.appendChild(badge);
        });
    }

    const isFraud = data.ensemble.verdict === "FRAUD";
    
    verdictBannerCard.className = "card verdict-banner " + (isFraud ? "verdict-fraud" : "verdict-legit");
    ensembleBadge.innerHTML = isFraud ? 
        `<i class="fa-solid fa-triangle-exclamation"></i> CRITICAL RISK` : 
        `<i class="fa-solid fa-circle-check"></i> APPROVED`;
    
    ensembleVerdictTitle.textContent = isFraud ? 
        "Transaction Flagged: Suspicious Behavioral Match" : 
        "Transaction Confirmed: Low Risk Profile";
    
    const confPct = data.ensemble.confidence * 100;
    ensembleConfidencePercent.textContent = confPct.toFixed(1) + "%";
    
    const fraudProbability = isFraud ? confPct : (100 - confPct);
    riskValueText.textContent = `Threat Level Score: ${fraudProbability.toFixed(1)}%`;
    riskThermometerBar.style.width = `${fraudProbability}%`;
    
    if (fraudProbability < 30) {
        riskThermometerBar.style.setProperty('--thermometer-glow', 'rgba(16, 185, 129, 0.4)');
    } else if (fraudProbability < 70) {
        riskThermometerBar.style.setProperty('--thermometer-glow', 'rgba(245, 158, 11, 0.4)');
    } else {
        riskThermometerBar.style.setProperty('--thermometer-glow', 'rgba(239, 68, 68, 0.4)');
    }
    
    ensembleVotes.innerHTML = `<i class="fa-solid fa-check-double"></i> ${data.ensemble.votes} of 3 models agreed`;

    const updateGauge = (gaugeEl, valueEl, badgeEl, prob) => {
        const probPct = Math.round(prob * 100);
        gaugeEl.querySelector('.gauge-ring').style.setProperty('--val', probPct);
        
        let startVal = 0;
        const duration = 800;
        const startTimestamp = performance.now();
        
        const animateText = (now) => {
            const progress = Math.min((now - startTimestamp) / duration, 1);
            const currentVal = Math.round(progress * probPct);
            valueEl.textContent = currentVal + "%";
            if (progress < 1) {
                requestAnimationFrame(animateText);
            } else {
                valueEl.textContent = probPct + "%";
            }
        };
        requestAnimationFrame(animateText);
        
        // Dynamic threshold evaluation (H-03)
        const isModelFraud = prob >= currentThreshold;
        badgeEl.textContent = isModelFraud ? "FRAUD" : "LEGIT";
        badgeEl.className = "badge " + (isModelFraud ? "badge-danger" : "badge-legit");
    };

    updateGauge(gaugeRf, gaugeValRf, badgeRf, data.models.rf.probability);
    updateGauge(gaugeXgb, gaugeValXgb, badgeXgb, data.models.xgb.probability);
    updateGauge(gaugeLgbm, gaugeValLgbm, badgeLgbm, data.models.lgbm.probability);

    const updateTableModel = (modelKey, prob) => {
        const probPct = (prob * 100).toFixed(1) + "%";
        document.getElementById(`prob-${modelKey}`).textContent = probPct;
        document.getElementById(`mini-bar-${modelKey}`).style.width = `${prob * 100}%`;
        
        // Dynamic threshold evaluation (H-03)
        const isModelFraud = prob >= currentThreshold;
        const badgeEl = document.getElementById(`badge-table-${modelKey}`);
        badgeEl.textContent = isModelFraud ? "FRAUD" : "LEGITIMATE";
        badgeEl.className = "badge " + (isModelFraud ? "badge-danger" : "badge-legit");
    };

    updateTableModel('rf', data.models.rf.probability);
    updateTableModel('xgb', data.models.xgb.probability);
    updateTableModel('lgbm', data.models.lgbm.probability);

    // Render Triggered Rules Heuristics
    const rulesCard = document.getElementById('rules-card');
    const rulesList = document.getElementById('rules-list');
    if (rulesCard && rulesList) {
        rulesList.innerHTML = '';
        if (data.rules_triggered && data.rules_triggered.length > 0) {
            rulesCard.classList.remove('hidden');
            data.rules_triggered.forEach(reason => {
                const li = document.createElement('li');
                li.textContent = reason;
                rulesList.appendChild(li);
            });
        } else {
            rulesCard.classList.add('hidden');
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. SHAP Chart Rendering
// ─────────────────────────────────────────────────────────────────────────────
// SHAP model select change event listener is safe-bound inside DOMContentLoaded

function renderSHAP(data, modelKey) {
    const ctx = document.getElementById('shapChart').getContext('2d');
    if (shapChartInstance) shapChartInstance.destroy();

    const shapValues = data.shap[modelKey] || [];
    const labels = shapValues.map(item => `${item.feature} (val: ${item.value.toFixed(2)})`);
    const values = shapValues.map(item => item.shap);
    const colors = values.map(val => val > 0 ? 'rgba(239, 68, 68, 0.85)' : 'rgba(16, 185, 129, 0.85)');
    const borderColors = values.map(val => val > 0 ? '#ef4444' : '#10b981');

    shapChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            return `Contribution: ${val > 0 ? '+' : ''}${val.toFixed(4)} (${val > 0 ? 'Pushes toward Fraud' : 'Pushes toward Legit'})`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' },
                    title: {
                        display: true,
                        text: '← Legit (Negative SHAP)       |       Fraud (Positive SHAP) →',
                        color: '#94a3b8',
                        font: { weight: 'bold' }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#f8fafc', font: { family: 'monospace', size: 12 } }
                }
            }
        }
    });

    generateSHAPSummary(shapValues, modelKey);
}

function generateSHAPSummary(shapValues, modelKey) {
    if (!shapSummaryText) return;
    if (shapValues.length === 0) {
        shapSummaryText.innerHTML = `<i class="fa-solid fa-circle-info"></i> No SHAP values available.`;
        return;
    }

    const fraudPushers = shapValues.filter(x => x.shap > 0);
    const legitPushers = shapValues.filter(x => x.shap < 0);
    
    let summaryHtml = `<i class="fa-solid fa-brain"></i> `;
    if (fraudPushers.length > 0) {
        const topFraud = fraudPushers[0];
        summaryHtml += `Parameter <strong class="shap-pos-keyword">${topFraud.feature}</strong> (val: ${topFraud.value.toFixed(2)}) is pushing the prediction towards <strong class="shap-pos-keyword">Fraud</strong> (+${topFraud.shap.toFixed(3)} influence). `;
    }
    if (legitPushers.length > 0) {
        const sortedLegit = [...legitPushers].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap));
        const topLegit = sortedLegit[0];
        summaryHtml += `Safety anchor <strong class="shap-neg-keyword">${topLegit.feature}</strong> (val: ${topLegit.value.toFixed(2)}) pulls it back towards <strong class="shap-neg-keyword">Legit</strong> (${topLegit.shap.toFixed(3)} credit).`;
    }
    shapSummaryText.innerHTML = summaryHtml;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Session statistics and review queue database sync
// ─────────────────────────────────────────────────────────────────────────────
async function loadSessionStats() {
    try {
        const res = await fetch(`/api/session-stats?threshold=${currentThreshold}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();
        const data = await res.json();

        // Update topbar header pills
        pillAnalyzed.textContent = data.total_analyzed;
        pillFlagged.textContent = data.fraud_flagged;
        pillFraudRate.textContent = data.fraud_rate.toFixed(2) + "%";

        // Update dashboard widgets
        if (dbSessionRate) {
            dbSessionRate.textContent = data.fraud_rate.toFixed(2) + "%";
            dbSessionFlaggedText.innerHTML = `<i class="fa-solid fa-flag text-danger"></i> <strong>${data.fraud_flagged}</strong> of <strong>${data.total_analyzed}</strong> flagged as Fraud`;
        }

    } catch (err) {
        console.error("Failed to load session counts:", err);
    }
}

async function loadHistoryQueue() {
    try {
        const res = await fetch('/api/history', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();
        historyLog = await res.json();
        
        renderQueueTable();
        renderDashboardActivity();
    } catch (err) {
        console.error("Queue load failure:", err);
    }
}

function renderQueueTable() {
    if (!queueTableBody) return;
    
    // Apply filters
    const searchVal = queueSearchInput ? queueSearchInput.value.toLowerCase().trim() : '';
    const filterVerdictVal = queueFilterVerdict ? queueFilterVerdict.value : 'all';

    let filtered = historyLog;
    if (searchVal) {
        filtered = filtered.filter(item => 
            item.txn_id.toLowerCase().includes(searchVal) ||
            item.cardholder.toLowerCase().includes(searchVal) ||
            item.merchant.toLowerCase().includes(searchVal)
        );
    }
    
    if (filterVerdictVal !== 'all') {
        filtered = filtered.filter(item => {
            // Use 2-of-3 majority vote (same logic as backend)
            let votes = 0;
            if (item.rf_prob >= currentThreshold) votes++;
            if (item.xgb_prob >= currentThreshold) votes++;
            if (item.lgbm_prob >= currentThreshold) votes++;
            const dynamicVerdict = votes >= 2 ? "FRAUD" : "LEGITIMATE";
            return dynamicVerdict === filterVerdictVal;
        });
    }

    if (filtered.length === 0) {
        queueTableBody.innerHTML = `
            <tr>
                <td colspan="9" class="history-placeholder">No matching audit records in the database.</td>
            </tr>
        `;
        return;
    }

    queueTableBody.innerHTML = '';
    filtered.forEach(item => {
        const row = document.createElement('tr');
        const formattedTime = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        // Calculate threat/fraud probability average
        const fraudRiskScore = Math.round(((item.rf_prob + item.xgb_prob + item.lgbm_prob) / 3) * 100);
        let riskColorClass = 'text-success';
        if (fraudRiskScore >= 70) riskColorClass = 'text-danger';
        else if (fraudRiskScore >= 30) riskColorClass = 'text-warning';

        // Calculate verdict dynamically using 2-of-3 majority vote
        let voteCount = 0;
        if (item.rf_prob >= currentThreshold) voteCount++;
        if (item.xgb_prob >= currentThreshold) voteCount++;
        if (item.lgbm_prob >= currentThreshold) voteCount++;
        const dynamicVerdict = voteCount >= 2 ? "FRAUD" : "APPROVED";
        const badgeClass = dynamicVerdict === "FRAUD" ? "badge-history-fraud" : "badge-history-legit";

        row.innerHTML = `
            <td><code>${item.txn_id}</code></td>
            <td>${formattedTime}</td>
            <td>${item.cardholder}</td>
            <td>${item.merchant}</td>
            <td><strong>$${item.amount.toFixed(2)}</strong></td>
            <td>
                <div class="score-indicator-row">
                    <span class="score-label-num ${riskColorClass}">${fraudRiskScore}%</span>
                </div>
            </td>
            <td><span class="${badgeClass}">${dynamicVerdict}</span></td>
            <td><code>${item.ensemble_votes}/3</code></td>
            <td><button type="button" class="btn btn-secondary btn-sm btn-view-audit" data-id="${item.txn_id}">Inspect</button></td>
        `;
        queueTableBody.appendChild(row);

        const btnInspect = row.querySelector('.btn-view-audit');
        btnInspect.addEventListener('click', (e) => {
            e.preventDefault();
            loadTransactionIntoAnalyzer(item);
        });
    });
}

function renderDashboardActivity() {
    if (!dbActivityBody) return;
    
    // Take top 5 recent session logs
    const subset = historyLog.slice(0, 5);

    if (subset.length === 0) {
        dbActivityBody.innerHTML = `
            <tr>
                <td colspan="6" class="activity-placeholder">No session activity recorded yet. Run a prediction to start.</td>
            </tr>
        `;
        return;
    }

    dbActivityBody.innerHTML = '';
    subset.forEach(item => {
        const row = document.createElement('tr');
        const formattedTime = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Calculate threat/fraud probability average
        const fraudRiskScore = Math.round(((item.rf_prob + item.xgb_prob + item.lgbm_prob) / 3) * 100);
        let riskColorClass = 'text-success';
        if (fraudRiskScore >= 70) riskColorClass = 'text-danger';
        else if (fraudRiskScore >= 30) riskColorClass = 'text-warning';

        // Calculate verdict dynamically using 2-of-3 majority vote
        let voteCountDash = 0;
        if (item.rf_prob >= currentThreshold) voteCountDash++;
        if (item.xgb_prob >= currentThreshold) voteCountDash++;
        if (item.lgbm_prob >= currentThreshold) voteCountDash++;
        const dynamicVerdict = voteCountDash >= 2 ? "FRAUD" : "APPROVED";
        const badgeClass = dynamicVerdict === "FRAUD" ? "badge-history-fraud" : "badge-history-legit";

        row.innerHTML = `
            <td>${formattedTime}</td>
            <td><div><strong>${item.cardholder}</strong></div><div class="text-muted" style="font-size:0.75rem">${item.merchant}</div></td>
            <td><strong>$${item.amount.toFixed(2)}</strong></td>
            <td><span class="${riskColorClass} font-weight-bold">${fraudRiskScore}%</span></td>
            <td><span class="${badgeClass}">${dynamicVerdict}</span></td>
            <td><button type="button" class="btn btn-secondary btn-sm btn-inspect-dash" data-id="${item.txn_id}">Inspect</button></td>
        `;
        dbActivityBody.appendChild(row);

        row.querySelector('.btn-inspect-dash').addEventListener('click', (e) => {
            e.preventDefault();
            loadTransactionIntoAnalyzer(item);
        });
    });
}

async function loadTransactionIntoAnalyzer(item) {
    if (!item || !item.txn_id) return;
    
    try {
        const res = await fetch(`/api/transaction/${item.txn_id}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error("Failed to load details from server.");
        const fullItem = await res.json();
        
        // Populate form fields
        const reconstructedParams = {
            Amount: fullItem.amount,
            Time: fullItem.txn_time,
            Cardholder: fullItem.cardholder,
            Card_Number: fullItem.card_number,
            Merchant: fullItem.merchant,
            Category: fullItem.category,
            Country: fullItem.country,
            Device: fullItem.device,
            ...fullItem.inputs
        };

        setFormValues(reconstructedParams);
        
        // Set response predictive outputs
        const resultObj = {
            ensemble: {
                verdict: fullItem.ensemble_verdict,
                confidence: fullItem.ensemble_confidence,
                votes: fullItem.ensemble_votes
            },
            models: {
                rf: { name: "Random Forest", verdict: fullItem.rf_prob >= currentThreshold ? "FRAUD" : "LEGITIMATE", probability: fullItem.rf_prob },
                xgb: { name: "XGBoost", verdict: fullItem.xgb_prob >= currentThreshold ? "FRAUD" : "LEGITIMATE", probability: fullItem.xgb_prob },
                lgbm: { name: "LightGBM", verdict: fullItem.lgbm_prob >= currentThreshold ? "FRAUD" : "LEGITIMATE", probability: fullItem.lgbm_prob }
            },
            shap: fullItem.shap
        };

        currentPredictionData = resultObj;

        // Switch view panel to analyzer
        switchView('analyzer-view');

        // Render results
        renderVerdict(resultObj, reconstructedParams);
        renderSHAP(resultObj, shapModelSelect.value);

        // Expand sliders grid
        if (pcaSection && pcaSection.classList.contains('collapsed')) {
            pcaSection.classList.remove('collapsed');
        }

        showToast(`Loaded transaction context: ${fullItem.txn_id}`, "success");
    } catch (err) {
        showToast("Error inspecting transaction: " + err.message, "danger");
    }
}

async function clearDatabase() {
    try {
        const res = await fetch('/api/history/clear', { 
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error();
        
        showToast("Session audit database cleared.", "success");
        loadSessionStats();
        loadHistoryQueue();
    } catch (err) {
        showToast("Failed to clear database.", "danger");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Dashboard Analytics Curves
// ─────────────────────────────────────────────────────────────────────────────
async function renderDashboardCharts() {
    try {
        const res = await fetch(`/api/analytics?threshold=${currentThreshold}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();
        const analytics = await res.json();

        // Guard: show empty state if no sessions recorded yet
        if (!historyLog || historyLog.length === 0) {
            ['dashboardTrendChart', 'dashboardVerdictChart', 'dashboardAmountChart'].forEach(id => {
                const canvas = document.getElementById(id);
                if (canvas) {
                    const ctx2d = canvas.getContext('2d');
                    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
                    ctx2d.font = '14px Inter, sans-serif';
                    ctx2d.fillStyle = '#64748b';
                    ctx2d.textAlign = 'center';
                    ctx2d.fillText('No transactions analyzed yet.', canvas.width / 2, canvas.height / 2);
                }
            });
            return;
        }

        // 1. Hourly Trend Line Chart
        const trendCtx = document.getElementById('dashboardTrendChart');
        if (trendCtx) {
            if (dbTrendChartInstance) dbTrendChartInstance.destroy();
            const labels = analytics.hourly_trend.map(x => x.hour);
            const totals = analytics.hourly_trend.map(x => x.total);
            const frauds = analytics.hourly_trend.map(x => x.fraud);

            dbTrendChartInstance = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Total Scans',
                            data: totals,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.05)',
                            fill: true,
                            borderWidth: 2,
                            tension: 0.35,
                            pointRadius: 3,
                            pointHoverRadius: 6
                        },
                        {
                            label: 'Fraud Alerts',
                            data: frauds,
                            borderColor: '#ef4444',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            tension: 0.35,
                            pointRadius: 3,
                            pointHoverRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 } } }
                    },
                    scales: {
                        x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } },
                        y: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
                    }
                }
            });
        }

        // 2. Verdict Doughnut Chart
        const verdictCtx = document.getElementById('dashboardVerdictChart');
        if (verdictCtx) {
            if (dbVerdictChartInstance) dbVerdictChartInstance.destroy();
            
            // Count dynamically from local historyLog
            let fraudCount = historyLog.filter(x => {
                const avgProb = (x.rf_prob + x.xgb_prob + x.lgbm_prob) / 3;
                return avgProb >= currentThreshold;
            }).length;
            let legitCount = historyLog.length - fraudCount;

            dbVerdictChartInstance = new Chart(verdictCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Approved', 'Flagged'],
                    datasets: [{
                        data: [legitCount || 1, fraudCount],
                        backgroundColor: ['#10b981', '#ef4444'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 } } }
                    },
                    cutout: '65%'
                }
            });
        }

        // 3. Amount Stacked Bar Histogram
        const amountCtx = document.getElementById('dashboardAmountChart');
        if (amountCtx) {
            if (dbAmountChartInstance) dbAmountChartInstance.destroy();

            const buckets = ['0-50', '50-200', '200-1000', '1000+'];
            const fraudCounts = [0, 0, 0, 0];
            const legitCounts = [0, 0, 0, 0];

            historyLog.forEach(x => {
                const avgProb = (x.rf_prob + x.xgb_prob + x.lgbm_prob) / 3;
                const isFraud = avgProb >= currentThreshold;
                let idx = 0;
                if (x.amount < 50) idx = 0;
                else if (x.amount < 200) idx = 1;
                else if (x.amount < 1000) idx = 2;
                else idx = 3;

                if (isFraud) fraudCounts[idx]++;
                else legitCounts[idx]++;
            });

            dbAmountChartInstance = new Chart(amountCtx, {
                type: 'bar',
                data: {
                    labels: buckets,
                    datasets: [
                        { label: 'Legit', data: legitCounts, backgroundColor: 'rgba(16, 185, 129, 0.85)', borderRadius: 3 },
                        { label: 'Fraud', data: fraudCounts, backgroundColor: 'rgba(239, 68, 68, 0.85)', borderRadius: 3 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 } } }
                    },
                    scales: {
                        x: { stacked: true, ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } },
                        y: { stacked: true, ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
                    }
                }
            });
        }

    } catch (err) {
        console.error("Charts draw failure:", err);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Report Downloader (CSV) & Single Export (PDF Window)
// ─────────────────────────────────────────────────────────────────────────────
function downloadHistoryCSV() {
    if (historyLog.length === 0) {
        showToast("No historical transactions available to export.", "warning");
        return;
    }
    const headers = ["Txn ID", "Timestamp", "Cardholder", "Card Number", "Merchant", "Category", "Country", "Device", "Amount", "Time", "Verdict", "Confidence", "RF Prob", "XGB Prob", "LGBM Prob"];
    const rows = historyLog.map(item => [
        item.txn_id,
        item.timestamp,
        item.cardholder,
        item.card_number,
        item.merchant,
        item.category,
        item.country,
        item.device,
        item.amount,
        item.txn_time,
        item.ensemble_verdict,
        item.ensemble_confidence,
        item.rf_prob,
        item.xgb_prob,
        item.lgbm_prob
    ]);
    const csvStr = [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CCFD_Radar_Audit_Report_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("CSV Audit file exported successfully!", "success");
}

function exportPredictionPDF() {
    if (!currentPredictionData) {
        showToast("Please run analysis on a transaction first.", "warning");
        return;
    }
    const printWindow = window.open('', '_blank', 'width=800,height=800');
    if (!printWindow) {
        showToast("Pop-up blocker prevented opening report print window.", "danger");
        return;
    }
    const data = currentPredictionData;
    const isFraud = data.ensemble.verdict === "FRAUD";
    const riskVal = isFraud ? (data.ensemble.confidence * 100) : (100 - data.ensemble.confidence * 100);
    // Get amount from the displayed input field as fallback since API response doesn't include it
    const txnAmount = parseFloat(inputAmount ? inputAmount.value : 0) || 0;

    const html = `
        <html>
        <head>
            <title>CCFD Radar - Transaction Risk Audit Report</title>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; padding: 40px; line-height: 1.5; }
                .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
                .logo { font-size: 24px; font-weight: 800; color: #0f172a; }
                .logo span { color: #3b82f6; }
                .verdict-box { padding: 20px; border-radius: 8px; margin-bottom: 30px; }
                .verdict-box.fraud { background: #fef2f2; border: 1px dashed #ef4444; color: #991b1b; }
                .verdict-box.legit { background: #ecfdf5; border: 1px dashed #10b981; color: #065f46; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
                .meta-table { width: 100%; border-collapse: collapse; }
                .meta-table td { padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
                .meta-table td.label { font-weight: bold; color: #64748b; width: 150px; }
                .probabilities { margin-bottom: 30px; }
                .bar-container { background: #e2e8f0; border-radius: 4px; height: 10px; overflow: hidden; margin-top: 5px; }
                .bar-fill { height: 100%; border-radius: 4px; }
                .footer { font-size: 11px; color: #94a3b8; text-align: center; margin-top: 50px; border-top: 1px solid #e2e8f0; padding-top: 20px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">CCFD <span>Radar</span></div>
                <div>Risk Audit Log</div>
            </div>
            <div class="verdict-box ${isFraud ? 'fraud' : 'legit'}">
                <h2 style="margin:0 0 10px 0;">Ensemble Resolution: ${isFraud ? 'FRAUD SUSPECT' : 'APPROVED (LEGITIMATE)'}</h2>
                <div style="font-size: 16px; font-weight: bold;">Threat Score Probability: ${riskVal.toFixed(1)}%</div>
                <div>Votes: ${data.ensemble.votes} of 3 classifiers agreed</div>
            </div>
            <h3>Transaction Metadata</h3>
            <div class="grid">
                <div>
                    <table class="meta-table">
                        <tr><td class="label">Transaction ID</td><td><code>${data.txn_id}</code></td></tr>
                        <tr><td class="label">Cardholder</td><td>${data.cardholder}</td></tr>
                        <tr><td class="label">Card Number</td><td>${data.card_number}</td></tr>
                        <tr><td class="label">Amount</td><td><strong>$${txnAmount.toFixed(2)}</strong></td></tr>
                    </table>
                </div>
                <div>
                    <table class="meta-table">
                        <tr><td class="label">Merchant Outlet</td><td>${data.merchant}</td></tr>
                        <tr><td class="label">Category</td><td>${data.category}</td></tr>
                        <tr><td class="label">Country Origin</td><td>${data.country}</td></tr>
                        <tr><td class="label">Device Signature</td><td>${data.device}</td></tr>
                    </table>
                </div>
            </div>
            <h3>Model Classification Probabilities</h3>
            <div class="probabilities">
                <div style="margin-bottom:15px;">
                    <div>Random Forest: ${(data.models.rf.probability * 100).toFixed(1)}%</div>
                    <div class="bar-container"><div class="bar-fill" style="width:${data.models.rf.probability * 100}%; background:#4ade80;"></div></div>
                </div>
                <div style="margin-bottom:15px;">
                    <div>XGBoost Model: ${(data.models.xgb.probability * 100).toFixed(1)}%</div>
                    <div class="bar-container"><div class="bar-fill" style="width:${data.models.xgb.probability * 100}%; background:#60a5fa;"></div></div>
                </div>
                <div style="margin-bottom:15px;">
                    <div>LightGBM Model: ${(data.models.lgbm.probability * 100).toFixed(1)}%</div>
                    <div class="bar-container"><div class="bar-fill" style="width:${data.models.lgbm.probability * 100}%; background:#f59e0b;"></div></div>
                </div>
            </div>
            <div class="footer">
                Printed dynamically via CCFD Radar Enterprise Risk Management Shell.<br>
                Confidence score based on majority-vote consensus of LightGBM, XGBoost and Random Forest.
            </div>
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                }
            </script>
        </body>
        </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Batch Mode Terminal JavaScript Processing
// ─────────────────────────────────────────────────────────────────────────────
let batchFileLoadedData = null;

const dragDropZone = document.getElementById('batch-drag-drop-zone');
const fileInput = document.getElementById('batch-file-input');
const fileInfo = document.getElementById('batch-file-info');
const jsonInput = document.getElementById('batch-json-input');
const batchThresholdSlider = document.getElementById('batch-threshold-slider');
const batchThresholdVal = document.getElementById('batch-threshold-val');
const btnBatchClear = document.getElementById('btn-batch-clear');
const btnBatchSubmit = document.getElementById('btn-batch-submit');
const progressBox = document.getElementById('batch-progress-box');
const progressBarFill = document.getElementById('batch-progress-bar-fill');
const progressStatus = document.getElementById('batch-progress-status');
const resultsSection = document.getElementById('batch-results-section');
const resultsTableBody = document.getElementById('batch-results-table-body');

function initBatchModeListeners() {
    if (batchThresholdSlider) {
        batchThresholdSlider.addEventListener('input', (e) => {
            if (batchThresholdVal) batchThresholdVal.textContent = e.target.value + '%';
        });
    }

    if (btnBatchClear) {
        btnBatchClear.addEventListener('click', () => {
            if (jsonInput) jsonInput.value = '';
            if (fileInput) fileInput.value = '';
            if (fileInfo) fileInfo.textContent = 'No file selected.';
            batchFileLoadedData = null;
            if (resultsSection) resultsSection.style.display = 'none';
            if (progressBox) progressBox.style.display = 'none';
            showToast("Batch inputs cleared.", "info");
        });
    }

    if (dragDropZone) {
        ['dragenter', 'dragover'].forEach(name => {
            dragDropZone.addEventListener(name, (e) => {
                e.preventDefault();
                dragDropZone.classList.add('dragover');
            });
        });
        
        ['dragleave', 'drop'].forEach(name => {
            dragDropZone.addEventListener(name, (e) => {
                e.preventDefault();
                dragDropZone.classList.remove('dragover');
            });
        });
        
        dragDropZone.addEventListener('drop', (e) => {
            if (e.dataTransfer.files.length > 0) {
                handleBatchCSV(e.dataTransfer.files[0]);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleBatchCSV(e.target.files[0]);
            }
        });
    }

    if (btnBatchSubmit) {
        btnBatchSubmit.addEventListener('click', runBatchAnalysis);
    }
}

function handleBatchCSV(file) {
    if (!file.name.endsWith('.csv')) {
        showToast("Please upload a valid CSV file.", "danger");
        return;
    }
    fileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    const reader = new FileReader();
    reader.onload = (e) => {
        batchFileLoadedData = parseCSVToTransactions(e.target.result);
        showToast(`Parsed ${batchFileLoadedData.length} rows from CSV file successfully.`, "success");
    };
    reader.readAsText(file);
}

function parseCSVToTransactions(csvText) {
    const lines = csvText.split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const list = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length < headers.length) continue;
        
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = cols[j];
        }
        list.push(row);
    }
    return list;
}

async function runBatchAnalysis() {
    let list = [];
    if (jsonInput && jsonInput.value.trim()) {
        try {
            list = JSON.parse(jsonInput.value);
            if (!Array.isArray(list)) throw new Error("JSON payload must be a root array of objects.");
        } catch (err) {
            showToast("JSON Format Error: " + err.message, "danger");
            return;
        }
    } else if (batchFileLoadedData) {
        list = batchFileLoadedData;
    } else {
        showToast("Please upload a CSV or paste a JSON array first.", "warning");
        return;
    }

    if (list.length === 0) {
        showToast("Transaction batch list is empty.", "warning");
        return;
    }

    btnBatchSubmit.disabled = true;
    if (progressBox) progressBox.style.display = 'block';
    if (resultsSection) resultsSection.style.display = 'none';

    progressBarFill.style.width = '0%';
    progressStatus.textContent = `0% (0 / ${list.length})`;

    const chunkSize = 100;
    const finalResults = [];
    let fraudCount = 0;
    let legitCount = 0;
    const currentBatchThreshold = parseFloat(batchThresholdSlider.value) / 100;

    try {
        for (let i = 0; i < list.length; i += chunkSize) {
            const chunk = list.slice(i, i + chunkSize);
            const res = await fetch('/api/predict/batch', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    transactions: chunk,
                    threshold: currentBatchThreshold
                })
            });

            if (!res.ok) throw new Error("Server batch prediction failed.");
            const data = await res.json();

            finalResults.push(...data.results);
            fraudCount += data.summary.fraud;
            legitCount += data.summary.legit;

            const progressVal = Math.round((finalResults.length / list.length) * 100);
            progressBarFill.style.width = `${progressVal}%`;
            progressStatus.textContent = `${progressVal}% (${finalResults.length} / ${list.length})`;
        }

        // Render batch results summaries
        if (resultsSection) resultsSection.style.display = 'block';
        document.getElementById('batch-stat-total').textContent = finalResults.length;
        document.getElementById('batch-stat-fraud').textContent = fraudCount;
        document.getElementById('batch-stat-legit').textContent = legitCount;
        document.getElementById('batch-stat-rate').textContent = (fraudCount / finalResults.length * 100).toFixed(2) + "%";

        if (resultsTableBody) {
            resultsTableBody.innerHTML = '';
            finalResults.forEach(item => {
                const row = document.createElement('tr');
                const badgeClass = item.verdict === "FRAUD" ? "badge-history-fraud" : "badge-history-legit";
                row.innerHTML = `
                    <td><code>${item.txn_id}</code></td>
                    <td>${item.cardholder}</td>
                    <td>${item.merchant}</td>
                    <td><strong>$${item.amount.toFixed(2)}</strong></td>
                    <td><code>${item.votes}/3</code></td>
                    <td><span class="${badgeClass}">${item.verdict === 'FRAUD' ? 'FRAUD' : 'APPROVED'}</span></td>
                    <td><button type="button" class="btn btn-secondary btn-sm btn-inspect-batch" data-id="${item.txn_id}">Inspect</button></td>
                `;
                resultsTableBody.appendChild(row);

                row.querySelector('.btn-inspect-batch').addEventListener('click', async (e) => {
                    e.preventDefault();
                    try {
                        const hRes = await fetch('/api/history', { headers: getAuthHeaders() });
                        if (!hRes.ok) throw new Error();
                        const hList = await hRes.json();
                        const match = hList.find(x => x.txn_id === item.txn_id);
                        if (match) {
                            switchView('analyzer-view');
                            document.querySelector('[data-mode="single"]').click();
                            loadTransactionIntoAnalyzer(match);
                        }
                    } catch (err) {
                        showToast("Failed to inspect batch item.", "danger");
                    }
                });
            });
        }

        showToast(`Processed ${finalResults.length} transactions successfully!`, "success");
        loadSessionStats();
        loadHistoryQueue();

    } catch (err) {
        showToast("Batch processing failed: " + err.message, "danger");
    } finally {
        btnBatchSubmit.disabled = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: Live Feed Transaction Simulator
// ─────────────────────────────────────────────────────────────────────────────
let simulatorIntervalId = null;

function toggleSimulatorFeed() {
    const btnSim = document.getElementById('btn-simulator-toggle');
    if (!btnSim) return;

    if (simulatorIntervalId) {
        clearInterval(simulatorIntervalId);
        simulatorIntervalId = null;
        btnSim.innerHTML = `<i class="fa-solid fa-play"></i> Start Live Feed`;
        btnSim.classList.remove('active');
        showToast("Simulator feed paused.", "info");
    } else {
        btnSim.innerHTML = `<span class="live-pulse-badge"><span class="pulse-dot"></span> LIVE FEED</span>`;
        btnSim.classList.add('active');
        showToast("Simulator feed started. Generating live audits...", "success");
        // Fire the first transaction immediately; subsequent ones every 4 seconds
        injectSimulatedTransaction();
        simulatorIntervalId = setInterval(injectSimulatedTransaction, 4000);
    }
}

async function injectSimulatedTransaction() {
    const isFraudSim = Math.random() < 0.30; // 30% fraud rate simulation

    const legitNames = ["Sarah Jenkins", "Robert Chen", "Sophia Bianchi", "Liam O'Connor", "Elena Rostova", "Kofi Mensah"];
    const fraudNames = ["Alice Smith", "Marcus Vance", "Carlos Mendez", "John Doe", "Unknown Cardholder"];
    const cardholder = isFraudSim ? 
        fraudNames[Math.floor(Math.random() * fraudNames.length)] : 
        legitNames[Math.floor(Math.random() * legitNames.length)];

    let cardNum = isFraudSim ? "5" : "4";
    for (let i = 0; i < 15; i++) {
        if (i > 0 && i % 4 === 3) cardNum += " ";
        cardNum += Math.floor(Math.random() * 10);
    }

    const amount = isFraudSim ? 
        parseFloat((Math.random() * 1800 + 200).toFixed(2)) : 
        parseFloat((Math.random() * 80 + 2.5).toFixed(2));

    const time = Math.floor(Math.random() * 172800);

    const merchants = {
        "Online Retail": ["Amazon Web Services", "eBay Merchant", "Shopify Storefront", "Alibaba Express"],
        "Food & Dining": ["McDonalds Restaurant", "Local Pizzeria", "Starbucks Store #940", "UberEats Delivery"],
        "Travel & Transportation": ["Uber Ride LLC", "Airbnb Reservation", "Delta Airlines Flight", "Eurostar Train Ticketing"],
        "Gas & Utilities": ["Chevron Gas Station", "Shell Petrol Pump", "National Power Grid", "Municipal Water Supply"],
        "Entertainment": ["Netflix Subscription", "Steam Games Store", "Ticketmaster Outlet", "Spotify Premium Music"],
        "Services & Support": ["Google Cloud Services", "Microsoft Azure Cloud", "Upwork Freelancer", "Github Copilot Sub"]
    };

    const categories = Object.keys(merchants);
    const category = isFraudSim ? "Travel & Transportation" : categories[Math.floor(Math.random() * categories.length)];
    const merchant = isFraudSim ? "Cryptocurrency Exchange Co." : merchants[category][Math.floor(Math.random() * merchants[category].length)];

    const countries = ["United States", "United Kingdom", "Germany", "France", "Japan", "Australia"];
    const country = isFraudSim ? ["France", "Germany", "Japan"][Math.floor(Math.random() * 3)] : countries[Math.floor(Math.random() * countries.length)];
    const device = isFraudSim ? "Automated API" : ["Mobile App", "Web Browser", "POS Terminal"][Math.floor(Math.random() * 3)];

    const boxMuller = () => {
        let u = 0, v = 0;
        while(u === 0) u = Math.random();
        while(v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };

    const payload = {
        Amount: amount,
        Time: time,
        Card_Number: cardNum,
        Cardholder: cardholder,
        Merchant: merchant,
        Category: category,
        Country: country,
        Device: device,
        threshold: currentThreshold
    };

    for (let i = 1; i <= 28; i++) {
        if (isFraudSim && [17, 14, 12, 10, 16, 4, 11].includes(i)) {
            payload[`V${i}`] = parseFloat((boxMuller() * 2 - 8).toFixed(2));
        } else {
            payload[`V${i}`] = parseFloat((boxMuller() * 1.5).toFixed(2));
        }
    }

    try {
        const response = await fetch('/api/predict', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error();
        const data = await response.json();

        const isEnsembleFraud = data.ensemble.verdict === 'FRAUD';
        showToast(
            `Simulated Feed: ${cardholder} ($${amount}) ${isEnsembleFraud ? 'FLAGGED AS FRAUD' : 'APPROVED'}`,
            isEnsembleFraud ? 'danger' : 'success'
        );

        loadSessionStats();
        loadHistoryQueue().then(() => {
            renderDashboardCharts();
        });

    } catch (err) {
        console.error("Simulated injection failure:", err);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6: Global Feature Correlations Heatmap Matrix
// ─────────────────────────────────────────────────────────────────────────────
let globalExplainabilityLoaded = false;
const heatmapFilter = document.getElementById('heatmap-feature-filter');
const heatmapGrid = document.getElementById('heatmap-grid');

async function loadHeatmapData() {
    if (globalExplainabilityLoaded) return;
    try {
        const res = await fetch('/api/global-explainability', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();
        const data = await res.json();

        window.correlationData = data.correlation_matrix;

        if (heatmapFilter) {
            heatmapFilter.innerHTML = '';
            data.feature_names.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = f;
                heatmapFilter.appendChild(opt);
            });
            heatmapFilter.value = 'Amount';
            heatmapFilter.addEventListener('change', (e) => renderHeatmapGrid(e.target.value));
        }

        globalExplainabilityLoaded = true;
        renderHeatmapGrid('Amount');
    } catch (err) {
        console.error("Failed to load correlation metadata:", err);
    }
}

function renderHeatmapGrid(focusFeature) {
    if (!heatmapGrid || !window.correlationData) return;

    const correlations = window.correlationData[focusFeature] || {};
    const features = Object.keys(window.correlationData);

    heatmapGrid.innerHTML = '';
    features.forEach(f => {
        const val = correlations[f] !== undefined ? correlations[f] : 0.0;
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';

        let cellBg = 'rgba(255, 255, 255, 0.02)';
        let textColor = '#94a3b8';

        if (val > 0.05) {
            cellBg = `rgba(239, 68, 68, ${Math.min(0.95, val * 0.9 + 0.15)})`;
            textColor = '#fff';
        } else if (val < -0.05) {
            cellBg = `rgba(59, 130, 246, ${Math.min(0.95, Math.abs(val) * 0.9 + 0.15)})`;
            textColor = '#fff';
        }

        cell.style.backgroundColor = cellBg;
        cell.style.color = textColor;
        cell.textContent = val.toFixed(2);
        cell.title = `Correlation coefficient [ ${focusFeature} ↔ ${f} ]: ${val.toFixed(3)}`;

        heatmapGrid.appendChild(cell);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7: Inline Editable Operator Settings & Keys shortcuts
// ─────────────────────────────────────────────────────────────────────────────
function initOperatorSettings() {
    const operatorInfo = document.querySelector('.operator-profile');
    const operatorNameDisplay = document.querySelector('.operator-name');

    if (operatorInfo && operatorNameDisplay) {
        const savedName = localStorage.getItem('ccfd_operator_name');
        if (savedName) operatorNameDisplay.textContent = savedName;

        operatorInfo.addEventListener('click', (e) => {
            e.stopPropagation();
            if (operatorInfo.querySelector('.operator-edit-input')) return;

            const currentName = operatorNameDisplay.textContent.trim();
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'operator-edit-input';
            input.value = currentName;

            operatorNameDisplay.style.display = 'none';
            operatorInfo.querySelector('.operator-info').prepend(input);
            input.focus();

            const saveName = () => {
                const newName = input.value.trim() || currentName;
                operatorNameDisplay.textContent = newName;
                operatorNameDisplay.style.display = 'block';
                localStorage.setItem('ccfd_operator_name', newName);
                input.remove();
                showToast(`Operator updated to: ${newName}`, "info");
            };

            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') saveName();
                if (ev.key === 'Escape') {
                    operatorNameDisplay.style.display = 'block';
                    input.remove();
                }
            });

            document.addEventListener('click', function clickAway(ev) {
                if (!operatorInfo.contains(ev.target)) {
                    saveName();
                    document.removeEventListener('click', clickAway);
                }
            });
        });
    }

    // Keyboard bindings listener
    document.addEventListener('keydown', (e) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT') {
            return;
        }

        // R key -> Randomize params
        if (e.key.toLowerCase() === 'r') {
            const rBtn = document.getElementById('randomize-btn');
            if (rBtn) {
                e.preventDefault();
                rBtn.click();
            }
        }

        // Ctrl + Enter -> Submit form
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            analyzerForm.dispatchEvent(new Event('submit'));
        }
    });
}

// Attach filters listeners
if (queueSearchInput) {
    queueSearchInput.addEventListener('input', renderQueueTable);
}
if (queueFilterVerdict) {
    queueFilterVerdict.addEventListener('change', renderQueueTable);
}
if (queueRefreshBtn) {
    queueRefreshBtn.addEventListener('click', loadHistoryQueue);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Model Performance and Tab Navs
// ─────────────────────────────────────────────────────────────────────────────
async function loadStats() {
    try {
        const res = await fetch('/api/stats', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();
        statsData = await res.json();
        
        renderComparisonMetrics();
    } catch (err) {
        console.error("Comparison stats fetch fail:", err);
    }
}

function renderComparisonMetrics() {
    if (!statsData) return;

    metricsTableBody.innerHTML = '';
    const keys = ['rf', 'xgb', 'lgbm'];
    
    keys.forEach(key => {
        const item = statsData[key];
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${item.name}</strong></td>
            <td id="metric-prec-${key}">${(item.metrics.precision * 100).toFixed(2)}%</td>
            <td id="metric-rec-${key}">${(item.metrics.recall * 100).toFixed(2)}%</td>
            <td id="metric-f1-${key}">${(item.metrics.f1 * 100).toFixed(2)}%</td>
            <td id="metric-auc-${key}">${item.metrics.roc_auc.toFixed(4)}</td>
        `;
        metricsTableBody.appendChild(row);
    });

    let maxPrec = 0, maxRec = 0, maxF1 = 0, maxAuc = 0;
    let winningPrecKey = '', winningRecKey = '', winningF1Key = '', winningAucKey = '';

    keys.forEach(key => {
        const m = statsData[key].metrics;
        if (m.precision > maxPrec) { maxPrec = m.precision; winningPrecKey = key; }
        if (m.recall > maxRec) { maxRec = m.recall; winningRecKey = key; }
        if (m.f1 > maxF1) { maxF1 = m.f1; winningF1Key = key; }
        if (m.roc_auc > maxAuc) { maxAuc = m.roc_auc; winningAucKey = key; }
    });

    if (winningPrecKey) document.getElementById(`metric-prec-${winningPrecKey}`).classList.add('best-metric-highlight');
    if (winningRecKey) document.getElementById(`metric-rec-${winningRecKey}`).classList.add('best-metric-highlight');
    if (winningF1Key) document.getElementById(`metric-f1-${winningF1Key}`).classList.add('best-metric-highlight');
    if (winningAucKey) document.getElementById(`metric-auc-${winningAucKey}`).classList.add('best-metric-highlight');

    keys.forEach(key => {
        const cm = statsData[key].metrics.confusion_matrix;
        if (cm) {
            document.getElementById(`cm-val-${key}-tn`).textContent = cm[0][0].toLocaleString();
            document.getElementById(`cm-val-${key}-fp`).textContent = cm[0][1].toLocaleString();
            document.getElementById(`cm-val-${key}-fn`).textContent = cm[1][0].toLocaleString();
            document.getElementById(`cm-val-${key}-tp`).textContent = cm[1][1].toLocaleString();
        }
    });

    renderROCChart();
    renderPRChart();
    renderFeatureImportanceChart(importanceModelSelect.value);
}

function renderROCChart() {
    const ctx = document.getElementById('rocChart').getContext('2d');
    if (rocChartInstance) rocChartInstance.destroy();

    const datasets = Object.keys(statsData).map(key => {
        const item = statsData[key];
        return {
            label: `${item.name} (AUC = ${item.roc.auc.toFixed(3)})`,
            data: item.roc.fpr.map((f, i) => ({ x: f, y: item.roc.tpr[i] })),
            borderColor: item.color,
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.1
        };
    });

    datasets.push({
        label: 'Random Guess',
        data: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1.5,
        borderDash: [6, 6],
        pointRadius: 0,
        backgroundColor: 'transparent'
    });

    rocChartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#f8fafc' } },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'False Positive Rate', color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' },
                    min: 0, max: 1
                },
                y: {
                    title: { display: true, text: 'True Positive Rate', color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' },
                    min: 0, max: 1
                }
            }
        }
    });
}

function renderPRChart() {
    const ctx = document.getElementById('prChart').getContext('2d');
    if (prChartInstance) prChartInstance.destroy();

    const datasets = Object.keys(statsData).map(key => {
        const item = statsData[key];
        return {
            label: `${item.name} (AUC = ${item.pr.auc.toFixed(3)})`,
            data: item.pr.recall.map((r, i) => ({ x: r, y: item.pr.precision[i] })),
            borderColor: item.color,
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.1
        };
    });

    prChartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#f8fafc' } },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Recall', color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' },
                    min: 0, max: 1
                },
                y: {
                    title: { display: true, text: 'Precision', color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' },
                    min: 0, max: 1
                }
            }
        }
    });
}

function renderFeatureImportanceChart(modelKey) {
    const ctx = document.getElementById('importanceChart').getContext('2d');
    if (importanceChartInstance) importanceChartInstance.destroy();

    const item = statsData[modelKey];
    const dataList = item.feature_importances || [];
    const labels = dataList.map(d => d.name);
    const values = dataList.map(d => d.importance);

    importanceChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: item.color,
                borderColor: item.color,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#f8fafc', font: { weight: 'bold' } }
                }
            }
        }
    });
}

function updateTimeHelper(secondsVal) {
    if (!timeHelper) return;
    
    if (isNaN(secondsVal) || secondsVal < 0) {
        timeHelper.innerHTML = `<span style="color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Enter a positive integer.</span>`;
        return;
    }

    const hours = Math.floor(secondsVal / 3600);
    const minutes = Math.floor((secondsVal % 3600) / 60);
    const seconds = secondsVal % 60;
    
    let timeString = [];
    if (hours > 0) timeString.push(`<strong>${hours}</strong> hour${hours > 1 ? 's' : ''}`);
    if (minutes > 0) timeString.push(`<strong>${minutes}</strong> minute${minutes > 1 ? 's' : ''}`);
    if (seconds > 0 || timeString.length === 0) timeString.push(`<strong>${seconds}</strong> second${seconds > 1 ? 's' : ''}`);

    timeHelper.innerHTML = `<i class="fa-regular fa-clock"></i> Equivalent to: ${timeString.join(', ')} elapsed since dataset start.`;
}

function bindAllEvents() {
    // 1. Sidebar Link Navigation Controls
    sidebarLinks.forEach(link => {
        link.addEventListener('click', () => {
            const targetView = link.getAttribute('data-view');
            switchView(targetView);
        });
    });

    if (dashboardGoQueue) {
        dashboardGoQueue.addEventListener('click', () => switchView('queue-view'));
    }

    // 2. Interactive Card Input Syncing
    if (inputCardholder) {
        inputCardholder.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            cardDisplayName.textContent = val ? val.toUpperCase() : "JOHN DOE";
        });
    }

    if (inputCardNumber) {
        inputCardNumber.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
            let formatted = '';
            for (let i = 0; i < val.length; i++) {
                if (i > 0 && i % 4 === 0) formatted += ' ';
                formatted += val[i];
            }
            e.target.value = formatted.substring(0, 19);
            
            const displayVal = e.target.value.trim();
            if (displayVal.length > 4) {
                let cardDigits = displayVal.replace(/\s+/g, '');
                let masked = '•••• •••• •••• ' + cardDigits.substring(cardDigits.length - 4);
                cardDisplayNumber.textContent = masked;
            } else {
                cardDisplayNumber.textContent = displayVal || "•••• •••• •••• 4242";
            }
        });
    }

    // 3. Collapsible Advanced Accordion Toggle
    if (pcaToggle) {
        pcaToggle.addEventListener('click', () => {
            pcaSection.classList.toggle('collapsed');
        });
    }

    // 4. Prediction Form Submit Handler
    if (analyzerForm) {
        analyzerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            inputAmount.style.borderColor = "";
            inputTime.style.borderColor = "";
            
            const amountVal = parseFloat(inputAmount.value);
            const timeVal = parseFloat(inputTime.value);
            
            let hasError = false;
            if (isNaN(amountVal) || amountVal < 0) {
                inputAmount.style.borderColor = "var(--danger)";
                showToast("Amount must be a positive number.", "danger");
                hasError = true;
            }
            if (isNaN(timeVal) || timeVal < 0) {
                inputTime.style.borderColor = "var(--danger)";
                showToast("Time must be a positive integer.", "danger");
                hasError = true;
            }
            
            if (hasError) return;
            
            submitBtn.disabled = true;
            btnSpinner.style.display = 'block';
            
            const payload = {
                Amount: amountVal,
                Time: timeVal,
                Card_Number: inputCardNumber.value || "4242 4242 4242 4242",
                Cardholder: inputCardholder.value || "John Doe",
                Merchant: inputMerchant.value || "Amazon Web Services",
                Category: inputCategory.value || "Online Retail",
                Country: inputCountry.value || "United States",
                Device: inputDevice.value || "Mobile App",
                threshold: currentThreshold
            };

            for (let i = 1; i <= 28; i++) {
                payload[`V${i}`] = parseFloat(document.getElementById(`slider-v${i}`).value);
            }

            try {
                const response = await fetch('/api/predict', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errBody = await response.json();
                    throw new Error(errBody.error || "Server prediction failed");
                }

                currentPredictionData = await response.json();
                
                renderVerdict(currentPredictionData, payload);
                renderSHAP(currentPredictionData, shapModelSelect.value);
                
                loadSessionStats();
                loadHistoryQueue().then(() => {
                    renderDashboardCharts();
                });

                showToast("Ensemble evaluation completed successfully!", "success");

            } catch (err) {
                showToast("Prediction Error: " + err.message, "danger");
                console.error("Prediction Error:", err);
            } finally {
                submitBtn.disabled = false;
                btnSpinner.style.display = 'none';
            }
        });
    }

    // 5. Reset Button Click Handler
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            inputCardholder.value = "John Doe";
            cardDisplayName.textContent = "JOHN DOE";
            inputCardNumber.value = "4242 4242 4242 4242";
            cardDisplayNumber.textContent = "•••• •••• •••• 4242";
            
            inputAmount.value = "45.00";
            inputTime.value = "10800";
            updateTimeHelper(10800);
            
            inputMerchant.value = "Amazon Web Services";
            inputCategory.value = "Online Retail";
            inputCountry.value = "United States";
            inputDevice.value = "Mobile App";

            for (let i = 1; i <= 28; i++) {
                const slider = document.getElementById(`slider-v${i}`);
                const display = document.getElementById(`val-v${i}`);
                if (slider && display) {
                    slider.value = "0";
                    display.textContent = "0.00";
                }
            }
            
            clearActivePresets();

            verdictSection.classList.add('hidden');
            currentPredictionData = null;
            if (shapChartInstance) {
                shapChartInstance.destroy();
                shapChartInstance = null;
            }

            showToast("Analysis parameters reset to defaults.", "info");
        });
    }

    // 6. Randomize Button Click Handler
    if (randomizeBtn) {
        randomizeBtn.addEventListener('click', () => {
            randomizeBtn.classList.add('pulse-anim');
            setTimeout(() => randomizeBtn.classList.remove('pulse-anim'), 400);

            const randAmount = (Math.random() * 2499.9 + 0.1).toFixed(2);
            inputAmount.value = randAmount;

            const randTime = Math.floor(Math.random() * 172801);
            inputTime.value = randTime;
            updateTimeHelper(randTime);

            const cardholders = ["Alex Morgan", "Elena Rostova", "Liam O'Connor", "Yuki Tanaka", "Kofi Mensah", "Sophia Bianchi"];
            const chosenHolder = cardholders[Math.floor(Math.random() * cardholders.length)];
            inputCardholder.value = chosenHolder;
            cardDisplayName.textContent = chosenHolder.toUpperCase();

            let cardNum = "4";
            for (let i = 0; i < 15; i++) {
                if (i > 0 && i % 4 === 3) cardNum += " ";
                cardNum += Math.floor(Math.random() * 10);
            }
            inputCardNumber.value = cardNum;
            cardDisplayNumber.textContent = '•••• •••• •••• ' + cardNum.substring(cardNum.length - 4);

            const merchants = {
                "Online Retail": ["Amazon Web Services", "eBay Merchant", "Shopify Storefront", "Alibaba Express"],
                "Food & Dining": ["McDonalds Restaurant", "Local Pizzeria", "Starbucks Store #940", "UberEats Delivery"],
                "Travel & Transportation": ["Uber Ride LLC", "Airbnb Reservation", "Delta Airlines Flight", "Eurostar Train Ticketing"],
                "Gas & Utilities": ["Chevron Gas Station", "Shell Petrol Pump", "National Power Grid", "Municipal Water Supply"],
                "Entertainment": ["Netflix Subscription", "Steam Games Store", "Ticketmaster Outlet", "Spotify Premium Music"],
                "Services & Support": ["Google Cloud Services", "Microsoft Azure Cloud", "Upwork Freelancer", "Github Copilot Sub"]
            };

            const categories = Object.keys(merchants);
            const chosenCategory = categories[Math.floor(Math.random() * categories.length)];
            const chosenMerchant = merchants[chosenCategory][Math.floor(Math.random() * merchants[chosenCategory].length)];

            inputCategory.value = chosenCategory;
            inputMerchant.value = chosenMerchant;

            const countries = ["United States", "United Kingdom", "Germany", "France", "Japan", "Australia"];
            inputCountry.value = countries[Math.floor(Math.random() * countries.length)];

            const devices = ["Mobile App", "Web Browser", "POS Terminal", "Automated API"];
            inputDevice.value = devices[Math.floor(Math.random() * devices.length)];

            const boxMuller = () => {
                let u = 0, v = 0;
                while(u === 0) u = Math.random();
                while(v === 0) v = Math.random();
                return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
            };

            for (let i = 1; i <= 28; i++) {
                const slider = document.getElementById(`slider-v${i}`);
                const display = document.getElementById(`val-v${i}`);
                if (slider && display) {
                    let val = boxMuller() * 1.5;
                    val = Math.max(-20, Math.min(20, val));
                    slider.value = val.toFixed(2);
                    display.textContent = parseFloat(val).toFixed(2);
                }
            }

            clearActivePresets();
            showToast("Randomized transaction card parameters loaded!", "success");
        });
    }

    // 7. SHAP model select change
    if (shapModelSelect) {
        shapModelSelect.addEventListener('change', (e) => {
            if (currentPredictionData) {
                renderSHAP(currentPredictionData, e.target.value);
            }
        });
    }

    // 8. Queue Table Filters
    if (queueSearchInput) {
        queueSearchInput.addEventListener('input', renderQueueTable);
    }
    if (queueFilterVerdict) {
        queueFilterVerdict.addEventListener('change', renderQueueTable);
    }
    if (queueRefreshBtn) {
        queueRefreshBtn.addEventListener('click', loadHistoryQueue);
    }

    // 9. Metrics View Selector
    if (importanceModelSelect) {
        importanceModelSelect.addEventListener('change', (e) => {
            if (statsData) {
                renderFeatureImportanceChart(e.target.value);
            }
        });
    }

    // 10. Metrics tabs navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetId = btn.getAttribute('data-tab');
            document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'explainability-panel') {
                loadHeatmapData();
            }
        });
    });

    // 11. API Command copies
    if (btnCopyCurl) {
        btnCopyCurl.addEventListener('click', () => {
            const text = document.getElementById('code-curl-content').textContent;
            navigator.clipboard.writeText(text).then(() => {
                showToast("Copied cURL command to clipboard", "success");
            });
        });
    }

    if (btnCopyJson) {
        btnCopyJson.addEventListener('click', () => {
            const text = document.getElementById('code-json-content').textContent;
            navigator.clipboard.writeText(text).then(() => {
                showToast("Copied JSON response structure", "success");
            });
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM Content Loaded Initializer
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Initialize DOM Elements safely inside DOMContentLoaded (H-04)
    slidersColLeft = document.getElementById('sliders-col-left');
    slidersColRight = document.getElementById('sliders-col-right');
    pcaToggle = document.getElementById('pca-toggle');
    pcaSection = document.querySelector('.pca-section');

    analyzerForm = document.getElementById('analyzer-form');
    submitBtn = document.getElementById('submit-btn');
    resetBtn = document.getElementById('reset-btn');
    randomizeBtn = document.getElementById('randomize-btn');
    btnSpinner = document.getElementById('btn-spinner');

    inputCardholder = document.getElementById('input-cardholder');
    inputCardNumber = document.getElementById('input-card-number');
    inputTime = document.getElementById('input-time');
    inputAmount = document.getElementById('input-amount');
    inputMerchant = document.getElementById('input-merchant');
    inputCategory = document.getElementById('input-category');
    inputCountry = document.getElementById('input-country');
    inputDevice = document.getElementById('input-device');
    timeHelper = document.getElementById('time-helper');

    cardDisplayNumber = document.getElementById('card-display-number');
    cardDisplayName = document.getElementById('card-display-name');

    verdictSection = document.getElementById('verdict-section');
    verdictBannerCard = document.getElementById('verdict-banner-card');
    ensembleBadge = document.getElementById('ensemble-badge');
    ensembleVerdictTitle = document.getElementById('ensemble-verdict-title');
    ensembleConfidencePercent = document.getElementById('ensemble-confidence-percent');
    ensembleVotes = document.getElementById('ensemble-votes');
    riskThermometerBar = document.getElementById('risk-thermometer-bar');
    riskValueText = document.getElementById('risk-value-text');

    gaugeRf = document.getElementById('gauge-rf');
    gaugeXgb = document.getElementById('gauge-xgb');
    gaugeLgbm = document.getElementById('gauge-lgbm');
    gaugeValRf = document.getElementById('gauge-val-rf');
    gaugeValXgb = document.getElementById('gauge-val-xgb');
    gaugeValLgbm = document.getElementById('gauge-val-lgbm');
    badgeRf = document.getElementById('badge-rf');
    badgeXgb = document.getElementById('badge-xgb');
    badgeLgbm = document.getElementById('badge-lgbm');

    shapSection = document.getElementById('shap-section');
    shapModelSelect = document.getElementById('shap-model-select');
    shapSummaryText = document.getElementById('shap-summary-text');

    metricsTableBody = document.getElementById('metrics-table-body');
    importanceModelSelect = document.getElementById('importance-model-select');

    sidebarLinks = document.querySelectorAll('.sidebar-link');
    viewPanels = document.querySelectorAll('.view-panel');
    pageTitle = document.getElementById('page-title');

    pillAnalyzed = document.getElementById('pill-analyzed');
    pillFlagged = document.getElementById('pill-flagged');
    pillFraudRate = document.getElementById('pill-fraud-rate');

    dbSessionRate = document.getElementById('db-session-rate');
    dbSessionFlaggedText = document.getElementById('db-session-flagged-text');
    dbActivityBody = document.getElementById('dashboard-activity-body');
    dashboardGoQueue = document.getElementById('dashboard-go-queue');

    queueRefreshBtn = document.getElementById('queue-refresh-btn');
    clearHistoryBtn = document.getElementById('clear-history-btn');
    queueSearchInput = document.getElementById('queue-search-input');
    queueFilterVerdict = document.getElementById('queue-filter-verdict');
    queueTableBody = document.querySelector('#queue-view #history-log-body');

    btnCopyCurl = document.getElementById('btn-copy-curl');
    btnCopyJson = document.getElementById('btn-copy-json');

    apiKeyInput = document.getElementById('api-key-input');
    if (apiKeyInput) {
        const savedKey = localStorage.getItem('sentinel_api_key');
        if (savedKey) apiKeyInput.value = savedKey;
        apiKeyInput.addEventListener('input', (e) => {
            localStorage.setItem('sentinel_api_key', e.target.value.trim());
        });
    }

    // 1. Setup UI Slider fields
    initSliders();
    
    // 2. Fetch API resource details
    loadPresets();
    loadStats();
    loadSessionStats();
    loadHistoryQueue().then(() => {
        // Render dashboard visuals after registry is fetched
        renderDashboardCharts();
    });

    // 3. Bind clear DB button
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            clearDatabase().then(() => {
                renderDashboardCharts();
            });
        });
    }

    // 4. Bind threshold tuner
    const thresholdSlider = document.getElementById('sensitivity-threshold-slider');
    const thresholdDisplay = document.getElementById('threshold-display-val');
    if (thresholdSlider) {
        thresholdSlider.value = Math.round(currentThreshold * 100);
        if (thresholdDisplay) thresholdDisplay.textContent = Math.round(currentThreshold * 100) + '%';
        thresholdSlider.addEventListener('change', (e) => {
            // Ensure currentThreshold is always synced on final 'change' event too
            currentThreshold = parseFloat(e.target.value) / 100;
            if (thresholdDisplay) thresholdDisplay.textContent = Math.round(currentThreshold * 100) + '%';
            loadSessionStats();
            renderQueueTable();
            renderDashboardActivity();
            renderDashboardCharts();
        });
        thresholdSlider.addEventListener('input', (e) => {
            currentThreshold = parseFloat(e.target.value) / 100;
            if (thresholdDisplay) thresholdDisplay.textContent = Math.round(currentThreshold * 100) + '%';
            renderQueueTable();
            renderDashboardActivity();
            renderDashboardCharts();
        });
    }

    // 5. Bind Export/Download Buttons
    const btnDownloadCsv = document.getElementById('queue-download-csv-btn');
    if (btnDownloadCsv) {
        btnDownloadCsv.addEventListener('click', downloadHistoryCSV);
    }
    
    const btnExportPdf = document.getElementById('btn-export-pdf');
    if (btnExportPdf) {
        btnExportPdf.addEventListener('click', exportPredictionPDF);
    }

    // 6. Bind Batch Mode tab switcher
    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const mode = tab.getAttribute('data-mode');
            const singleContainer = document.getElementById('single-analysis-container');
            const batchContainer = document.getElementById('batch-analysis-container');
            
            if (mode === 'batch') {
                singleContainer.style.display = 'none';
                batchContainer.style.display = 'block';
            } else {
                singleContainer.style.display = 'block';
                batchContainer.style.display = 'none';
            }
        });
    });

    // 7. Bind All Events (H-04)
    bindAllEvents();

    // 8. Initialize Sub-modules
    initBatchModeListeners();
    initOperatorSettings();

    // 9. Bind Live Feed simulator toggle button
    const simToggleBtn = document.getElementById('btn-simulator-toggle');
    if (simToggleBtn) {
        simToggleBtn.addEventListener('click', toggleSimulatorFeed);
    }
});
