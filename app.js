/**
 * ===================================================================
 * OMR VISION STUDIO PRO - CORE ENGINE (app.js)
 * Architecture: Modular State, Pure Vision Math & Rescan Pipeline
 * ===================================================================
 */

// ==========================================
// 1. GLOBAL STATE & MASTER ANSWER KEY
// ==========================================
const MASTER_ANSWER_KEY = { 1: "B", 2: "A", 3: "C", 4: "D", 5: "A" };
const OPTIONS = ["A", "B", "C", "D"];

let currentRollNumber = 1001;
let isMobileScannerActive = false;
let cameraMediaStream = null;

// Scanned Records & Anti-Duplicate Memory
let scanHistoryLog = JSON.parse(localStorage.getItem("omr_pro_logs") || "[]");
const verifiedRollsSet = new Set(scanHistoryLog.map(item => item.roll));

// Mathematical Vectors relative to QR Code
// Calculated from Sheet DOM Geometry
const U_OFFSETS = [-0.25, 0.35, 0.95, 1.55];       // Columns A, B, C, D
const V_OFFSETS = [1.65, 2.15, 2.65, 3.15, 3.65];   // Rows Q1, Q2, Q3, Q4, Q5

// ==========================================
// 2. AUDIO & HAPTIC FEEDBACK ENGINE
// ==========================================
function triggerSuccessFeedback() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    // Two-tone Apple-style chime
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioContext.currentTime); // A5 note
    osc.frequency.exponentialRampToValueAtTime(1318.51, audioContext.currentTime + 0.12); // E6 note

    gain.gain.setValueAtTime(0.18, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.16);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start();
    osc.stop(audioContext.currentTime + 0.16);

    // Haptic vibration for mobile phones
    if (navigator.vibrate) {
      navigator.vibrate([40, 30, 50]);
    }
  } catch (err) {
    console.warn("Audio Context init suppressed:", err);
  }
}

// ==========================================
// 3. LAPTOP SHEET CONTROLS & 3D FLIP CARD
// ==========================================

// Next Sheet Generator
function generateNextSheet(autoFill = true) {
  currentRollNumber++;
  const rollString = `ROLL-${currentRollNumber}`;
  
  // Update DOM Roll Display
  document.getElementById("sheet-roll-text").innerText = rollString;

  // Generate Crisp QR Code
  const qrContainer = document.getElementById("qrcode-box");
  qrContainer.innerHTML = "";
  new QRCode(qrContainer, {
    text: rollString,
    width: 100,
    height: 100,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  // Reset & Populate Bubbles
  document.querySelectorAll(".omr-row").forEach((row, idx) => {
    const bubbles = row.querySelectorAll(".bubble");
    bubbles.forEach(b => b.classList.remove("filled"));

    if (autoFill) {
      // 80% realistic accuracy simulation
      const isCorrect = Math.random() > 0.20;
      const selectedOption = isCorrect 
        ? MASTER_ANSWER_KEY[idx + 1] 
        : OPTIONS[Math.floor(Math.random() * OPTIONS.length)];

      bubbles.forEach(b => {
        if (b.dataset.opt === selectedOption) {
          b.classList.add("filled");
        }
      });
    }
  });
}

// Clear all bubbles to test manual fills or blank sheets
function clearAllBubbles() {
  document.querySelectorAll(".bubble").forEach(b => b.classList.remove("filled"));
}

// 3D Card Flip Handler
function toggleFlipSheet() {
  const card = document.getElementById("sheet-flip-card");
  card.classList.toggle("flipped");
}

// Bubble Untick & Click Handler (With Blank Toggle Capability)
function initBubbleClickHandlers() {
  document.querySelectorAll(".omr-row").forEach(row => {
    const bubbles = row.querySelectorAll(".bubble");
    bubbles.forEach(bubble => {
      bubble.addEventListener("click", () => {
        const isAlreadyFilled = bubble.classList.contains("filled");
        
        // Unfill all options in this row
        bubbles.forEach(b => b.classList.remove("filled"));

        // If it was NOT filled previously, fill it now.
        // If it WAS already filled, leaving it unselected (UNTICK / BLANK)
        if (!isAlreadyFilled) {
          bubble.classList.add("filled");
        }
      });
    });
  });
}

// Keyboard Shortcuts (Space: Next Sheet, F: Flip Sheet)
window.addEventListener("keydown", (e) => {
  const laptopView = document.getElementById("view-laptop");
  if (!laptopView.classList.contains("hidden")) {
    if (e.code === "Space") {
      e.preventDefault();
      generateNextSheet(true);
    } else if (e.code === "KeyF") {
      e.preventDefault();
      toggleFlipSheet();
    }
  }
});

// ==========================================
// 4. NAVIGATION & VIEWPORT SWITCHER
// ==========================================
function switchAppMode(mode) {
  const btnLaptop = document.getElementById("btn-mode-laptop");
  const btnMobile = document.getElementById("btn-mode-mobile");
  const viewLaptop = document.getElementById("view-laptop");
  const viewMobile = document.getElementById("view-mobile");

  if (mode === "laptop") {
    btnLaptop.classList.add("active");
    btnMobile.classList.remove("active");
    viewLaptop.classList.remove("hidden");
    viewMobile.classList.add("hidden");
    stopMobileCamera();
  } else {
    btnMobile.classList.add("active");
    btnLaptop.classList.remove("active");
    viewMobile.classList.remove("hidden");
    viewLaptop.classList.add("hidden");
    startMobileCamera();
  }
}

// ==========================================
// 5. MOBILE VISION SCANNER & MAGNET ENGINE
// ==========================================
const processingCanvas = document.createElement("canvas");
const processingCtx = processingCanvas.getContext("2d", { willReadFrequently: true });
let nativeBarcodeEngine = null;

if ("BarcodeDetector" in window) {
  nativeBarcodeEngine = new BarcodeDetector({ formats: ["qr_code"] });
}

async function startMobileCamera() {
  try {
    cameraMediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    const videoEl = document.getElementById("video");
    videoEl.srcObject = cameraMediaStream;
    await videoEl.play();
    isMobileScannerActive = true;
    requestAnimationFrame(renderScannerPipeline);
  } catch (err) {
    alert("Camera Access Error: " + err.message);
  }
}

function stopMobileCamera() {
  isMobileScannerActive = false;
  if (cameraMediaStream) {
    cameraMediaStream.getTracks().forEach(track => track.stop());
    cameraMediaStream = null;
  }
}

// Main Frame Processing Loop
async function renderScannerPipeline() {
  if (!isMobileScannerActive) return;

  const video = document.getElementById("video");
  const arCanvas = document.getElementById("ar-canvas");
  const arCtx = arCanvas.getContext("2d");

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    processingCanvas.width = video.videoWidth;
    processingCanvas.height = video.videoHeight;
    processingCtx.drawImage(video, 0, 0);

    arCanvas.width = video.videoWidth;
    arCanvas.height = video.videoHeight;
    arCtx.clearRect(0, 0, arCanvas.width, arCanvas.height);

    let detectedQRData = null;
    let qrBoundingCorners = null;

    // Fast-path: Native iOS Safari Barcode Detector
    if (nativeBarcodeEngine) {
      try {
        const barcodes = await nativeBarcodeEngine.detect(video);
        if (barcodes.length > 0 && barcodes[0].rawValue.startsWith("ROLL-")) {
          detectedQRData = barcodes[0].rawValue;
          const cornerPoints = barcodes[0].cornerPoints;
          if (cornerPoints && cornerPoints.length >= 4) {
            qrBoundingCorners = {
              tl: cornerPoints[0],
              tr: cornerPoints[1],
              br: cornerPoints[2],
              bl: cornerPoints[3]
            };
          }
        }
      } catch (e) {}
    }

    // Fallback: Pure JS jsQR engine
    if (!detectedQRData) {
      const imgData = processingCtx.getImageData(0, 0, processingCanvas.width, processingCanvas.height);
      const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "dontInvert" });
      if (code && code.data.startsWith("ROLL-")) {
        detectedQRData = code.data;
        qrBoundingCorners = {
          tl: code.location.topLeftCorner,
          tr: code.location.topRightCorner,
          br: code.location.bottomRightCorner,
          bl: code.location.bottomLeftCorner
        };
      }
    }

    // Evaluate Frame if QR Code is Present
    if (detectedQRData && qrBoundingCorners) {
      const rollId = detectedQRData;

      // Duplicate Check: Already Verified?
      if (verifiedRollsSet.has(rollId)) {
        document.getElementById("hud-status").innerText = `✅ ${rollId} Verified`;
        document.getElementById("hud-status").style.background = "#10b981";
        document.getElementById("hud-lock").innerText = "LOCKED";
        document.getElementById("hud-tip").innerText = "Press Spacebar on laptop for next candidate";
      } else {
        // Run Precision Matrix Evaluation
        evaluateCandidateSheet(processingCtx, arCtx, qrBoundingCorners, rollId, video.videoWidth, video.videoHeight);
      }
    } else {
      document.getElementById("hud-status").innerText = "Searching Sheet...";
      document.getElementById("hud-status").style.background = "#f59e0b";
      document.getElementById("hud-lock").innerText = "IDLE";
      document.getElementById("hud-tip").innerText = "Fit complete sheet inside the viewfinder";
    }
  }

  // Scanning loop throttled to ~20 FPS for battery & precision
  setTimeout(() => requestAnimationFrame(renderScannerPipeline), 50);
}

/**
 * Precision Evaluation with Magnet Search & Relative Contrast
 */
function evaluateCandidateSheet(ctx, arCtx, corners, rollId, viewW, viewH) {
  const { tl, tr, bl } = corners;

  // Perspective Vectors
  const Ux = tr.x - tl.x;
  const Uy = tr.y - tl.y;
  const Vx = bl.x - tl.x;
  const Vy = bl.y - tl.y;
  const qrSize = Math.hypot(Ux, Uy);

  // 1. Boundary & Completeness Verification Gate
  // Check if Q5 (bottom-most bubble) is safely within camera viewport bounds
  const q5CheckX = tl.x + U_OFFSETS[3] * Ux + V_OFFSETS[4] * Vx;
  const q5CheckY = tl.y + U_OFFSETS[3] * Uy + V_OFFSETS[4] * Vy;

  const isSheetCutOff = (
    q5CheckY > viewH - 25 || q5CheckY < 25 ||
    q5CheckX > viewW - 25 || q5CheckX < 25 ||
    tl.y < 20 || tl.x < 20
  );

  if (isSheetCutOff) {
    document.getElementById("hud-status").innerText = "⚠️ Sheet Cut Rahi Hai - Thoda Peeche Karein";
    document.getElementById("hud-status").style.background = "#ef4444";
    document.getElementById("hud-lock").innerText = "REPOSITION";
    document.getElementById("hud-tip").innerText = "Puri sheet camera me aane dein";
    return; // Reject cut/incomplete frame
  }

  // Draw AR Perspective Wireframe
  arCtx.strokeStyle = "#38bdf8";
  arCtx.lineWidth = 3;
  arCtx.beginPath();
  arCtx.moveTo(tl.x, tl.y);
  arCtx.lineTo(tr.x, tr.y);
  arCtx.lineTo(corners.br.x, corners.br.y);
  arCtx.lineTo(bl.x, bl.y);
  arCtx.closePath();
  arCtx.stroke();

  const answers = {};
  let totalScore = 0;
  let detectedMarkCount = 0;
  const nominalRadius = Math.max(6, Math.floor(qrSize * 0.12));

  // 2. Loop Through All 5 Questions
  for (let q = 1; q <= 5; q++) {
    const rowV = V_OFFSETS[q - 1];
    const rowSamples = [];

    // Analyze All 4 Options (A, B, C, D)
    for (let opt = 0; opt < 4; opt++) {
      const colU = U_OFFSETS[opt];

      // Theoretical Center
      const theoreticalX = Math.floor(tl.x + colU * Ux + rowV * Vx);
      const theoreticalY = Math.floor(tl.y + colU * Uy + rowV * Vy);

      // Magnet Search Algorithm:
      // Search a local window around theoretical point to find actual ink centroid
      let bestX = theoreticalX;
      let bestY = theoreticalY;
      let minSearchBrightness = 255;
      const searchWindow = Math.floor(nominalRadius * 0.5);

      try {
        const searchBox = ctx.getImageData(
          theoreticalX - searchWindow, 
          theoreticalY - searchWindow, 
          searchWindow * 2, 
          searchWindow * 2
        ).data;

        for (let dy = -searchWindow; dy < searchWindow; dy += 2) {
          for (let dx = -searchWindow; dx < searchWindow; dx += 2) {
            const index = ((dy + searchWindow) * (searchWindow * 2) + (dx + searchWindow)) * 4;
            const b = (searchBox[index] + searchBox[index + 1] + searchBox[index + 2]) / 3;
            if (b < minSearchBrightness) {
              minSearchBrightness = b;
              bestX = theoreticalX + dx;
              bestY = theoreticalY + dy;
            }
          }
        }
      } catch (e) {}

      // Letter-Immune Inner Core Density (Sample only central 60%)
      const innerCoreR = Math.max(3, Math.floor(nominalRadius * 0.55));
      let sumCoreBrightness = 0;
      let pixelCounter = 0;

      try {
        const coreData = ctx.getImageData(bestX - innerCoreR, bestY - innerCoreR, innerCoreR * 2, innerCoreR * 2).data;
        for (let i = 0; i < coreData.length; i += 4) {
          sumCoreBrightness += (coreData[i] + coreData[i+1] + coreData[i+2]) / 3;
          pixelCounter++;
        }
      } catch (e) {}

      const coreAverageBrightness = pixelCounter > 0 ? (sumCoreBrightness / pixelCounter) : 255;
      rowSamples.push({
        opt: OPTIONS[opt],
        x: bestX,
        y: bestY,
        brightness: coreAverageBrightness
      });
    }

    // 3. Relative Contrast Classification
    // Find the darkest candidate in this question row
    let darkestCandidate = rowSamples[0];
    rowSamples.forEach(sample => {
      if (sample.brightness < darkestCandidate.brightness) {
        darkestCandidate = sample;
      }
    });

    // Compute average brightness of the remaining 3 white bubbles
    const otherCandidates = rowSamples.filter(s => s.opt !== darkestCandidate.opt);
    const avgOtherBrightness = otherCandidates.reduce((acc, curr) => acc + curr.brightness, 0) / otherCandidates.length;

    let evaluatedMark = "BLANK";

    // RELATIVE GAP THRESHOLD:
    // If darkest bubble is at least 32 brightness units darker than surrounding white bubbles,
    // AND absolute brightness is under 135 (solid ink), it is decisively MARKED.
    if ((avgOtherBrightness - darkestCandidate.brightness > 32) && darkestCandidate.brightness < 135) {
      evaluatedMark = darkestCandidate.opt;
      detectedMarkCount++;
    }

    answers[q] = evaluatedMark;
    if (evaluatedMark === MASTER_ANSWER_KEY[q]) {
      totalScore++;
    }

    // Live AR Visualization Rings on Camera
    rowSamples.forEach(s => {
      arCtx.beginPath();
      arCtx.arc(s.x, s.y, nominalRadius + 2, 0, 2 * Math.PI);
      if (s.opt === evaluatedMark) {
        arCtx.fillStyle = "rgba(16, 185, 129, 0.4)";
        arCtx.fill();
        arCtx.strokeStyle = "#10b981";
        arCtx.lineWidth = 4;
      } else {
        arCtx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        arCtx.lineWidth = 1.5;
      }
      arCtx.stroke();
    });
  }

  // 4. Stability Check: Reject all-blank frames (prevents blurry / premature saves)
  if (detectedMarkCount === 0) {
    document.getElementById("hud-status").innerText = "⚠️ Hold Steady - Aligning Bubbles";
    document.getElementById("hud-status").style.background = "#f59e0b";
    document.getElementById("hud-lock").innerText = "SEARCHING";
    return;
  }

  // 5. SUCCESS: Register & Permanently Lock This Candidate
  verifiedRollsSet.add(rollId);
  triggerSuccessFeedback();

  const formattedTime = new Date().toLocaleTimeString();
  const evaluationRecord = {
    roll: rollId,
    score: totalScore,
    answers: answers,
    status: totalScore >= 3 ? "PASS" : "FAIL",
    timestamp: formattedTime
  };

  // Add to History & Local Storage
  scanHistoryLog.unshift(evaluationRecord);
  localStorage.setItem("omr_pro_logs", JSON.stringify(scanHistoryLog));

  // Update Result Banner UI
  document.getElementById("res-roll").innerText = rollId;
  document.getElementById("res-score").innerText = `${totalScore} / 5 Marks`;
  document.getElementById("res-timestamp").innerText = formattedTime;
  document.getElementById("res-ans").innerText = `Responses: Q1:${answers[1]}, Q2:${answers[2]}, Q3:${answers[3]}, Q4:${answers[4]}, Q5:${answers[5]}`;

  renderHistoryTable();
}

// ==========================================
// 6. SCANNED LOG & RESCAN / DELETE ENGINE
// ==========================================

function renderHistoryTable() {
  const tbody = document.getElementById("log-tbody");
  tbody.innerHTML = "";
  document.getElementById("total-count").innerText = scanHistoryLog.length;

  scanHistoryLog.forEach(record => {
    const tr = document.createElement("tr");

    const answersPreview = Object.values(record.answers).join(", ");
    const isPassed = record.status === "PASS";

    tr.innerHTML = `
      <td><b>${record.roll}</b></td>
      <td style="font-weight: 800; color: ${isPassed ? '#10b981' : '#ef4444'}">${record.score} / 5</td>
      <td style="color: #64748b; font-family: monospace;">${answersPreview}</td>
      <td>
        <span class="status-tag ${isPassed ? 'tag-pass' : 'tag-fail'}">${record.status}</span>
      </td>
      <td>
        <button class="btn-action-del" onclick="deleteAndEnableRescan('${record.roll}')">
          ✕ Cut / Rescan
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Critical Feature: Delete Record and Enable Immediate Rescan
 */
window.deleteAndEnableRescan = function(rollIdToDelete) {
  // 1. Remove from Log Array
  scanHistoryLog = scanHistoryLog.filter(item => item.roll !== rollIdToDelete);
  localStorage.setItem("omr_pro_logs", JSON.stringify(scanHistoryLog));

  // 2. CRUCIAL: Release the State Lock from the Set
  verifiedRollsSet.delete(rollIdToDelete);

  // 3. Update UI Table
  renderHistoryTable();

  // Reset Active Banner if it displayed the deleted roll
  if (document.getElementById("res-roll").innerText === rollIdToDelete) {
    document.getElementById("res-roll").innerText = "Awaiting Scan...";
    document.getElementById("res-score").innerText = "--";
    document.getElementById("res-ans").innerText = "Responses: --";
  }

  // Confirmation Toast via HUD
  const hudStatus = document.getElementById("hud-status");
  hudStatus.innerText = `🔓 ${rollIdToDelete} Unlocked for Rescan`;
  hudStatus.style.background = "#0284c7";
};

// CSV Data Exporter
function exportScanLogToCSV() {
  if (scanHistoryLog.length === 0) {
    alert("No scanned evaluations available to export!");
    return;
  }

  let csvContent = "Roll ID,Score,Total,Q1,Q2,Q3,Q4,Q5,Status,Timestamp\n";
  scanHistoryLog.forEach(row => {
    csvContent += `${row.roll},${row.score},5,${row.answers[1]},${row.answers[2]},${row.answers[3]},${row.answers[4]},${row.answers[5]},${row.status},${row.timestamp}\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.setAttribute("href", url);
  downloadLink.setAttribute("download", `OMR_Master_Report_${Date.now()}.csv`);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

// ==========================================
// 7. INITIALIZATION CONTROLLER
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  // Navigation Mode Switchers
  document.getElementById("btn-mode-laptop").addEventListener("click", () => switchAppMode("laptop"));
  document.getElementById("btn-mode-mobile").addEventListener("click", () => switchAppMode("mobile"));

  // Toolbar Actions
  document.getElementById("btn-next-sheet").addEventListener("click", () => generateNextSheet(true));
  document.getElementById("btn-blank-sheet").addEventListener("click", clearAllBubbles);
  document.getElementById("btn-flip-sheet").addEventListener("click", toggleFlipSheet);
  document.getElementById("btn-export-csv").addEventListener("click", exportScanLogToCSV);

  // Initialize Interactive Elements
  initBubbleClickHandlers();
  generateNextSheet(true);
  renderHistoryTable();
});
