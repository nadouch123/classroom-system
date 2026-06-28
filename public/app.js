document.addEventListener('DOMContentLoaded', () => {
    // ====== CONFIGURATION ======
    const SUPABASE_URL = "https://ioenxnbrggkcharfuvqq.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZW54bmJyZ2drY2hhcmZ1dnFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzA4NzgsImV4cCI6MjA5NjQwNjg3OH0.W6f8BWLvFeEoVinQUEwbKs9ckycvJamrYze5EmmmTHA";
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const MQTT_HOST = "8b3f08bad638441bb7bc39536961734b.s1.eu.hivemq.cloud";
    const MQTT_PORT = 8884; 
    const MQTT_USER = "enitAttendanceSystem";
    const MQTT_PASS = "enitAttendanceSystem123";

    // FIXED: Hardcoded your API key so it works in the browser
    const GEMINI_API_KEY = "AQ.Ab8RN6LDbAQ05plipR0HOjUFyEveaX9e9pflnRdpV7GarnAS3w"; 
    
    let mqttClient;
    let isConnected = false;
    
    let scheduleData = {
        classroom: "111",
        validity: { from: "2023-09-01", to: "2024-06-30" },
        schedule: {
            "Monday": [], "Tuesday": [], "Wednesday": [], "Thursday": [], "Friday": [], 
            "Saturday": [], "Sunday": []
        }
    }; 

    // ====== UI ELEMENTS ======
    const loginScreen = document.getElementById('loginScreen');
    const appScreen = document.getElementById('appScreen');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const loginError = document.getElementById('loginError');

    const deviceSelect = document.getElementById('deviceSelect');
    const sendScheduleBtn = document.getElementById('sendSchedule');
    const deviceList = document.getElementById('deviceList');
    const refreshBtn = document.getElementById('refreshDevices');
    
    const validFrom = document.getElementById('validFrom');
    const validTo = document.getElementById('validTo');
    const slotDay = document.getElementById('slotDay');
    const slotStartTime = document.getElementById('slotStartTime'); 
    const slotEndTime = document.getElementById('slotEndTime');   
    const slotSubject = document.getElementById('slotSubject');
    const slotProfessor = document.getElementById('slotProfessor');
    const slotSection = document.getElementById('slotSection');
    const addSlotBtn = document.getElementById('addSlotBtn');
    const resetScheduleBtn = document.getElementById('resetScheduleBtn');
    const previewArea = document.getElementById('previewArea');
    const slotError = document.getElementById('slotError');

    const pdfUpload = document.getElementById('pdfUpload');
    const parsePdfBtn = document.getElementById('parsePdfBtn');
    const pdfStatus = document.getElementById('pdfStatus');

    // ====== AUTHENTICATION LOGIC ======
    loginBtn.addEventListener('click', async () => {
        const email = loginEmail.value;
        const password = loginPassword.value;
        
        if(!email || !password) {
            loginError.innerText = "Please enter email and password";
            loginError.classList.remove('hidden');
            return;
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            loginError.innerText = "Error: " + error.message;
            loginError.classList.remove('hidden');
        } else {
            loginError.classList.add('hidden');
            checkAuth();
        }
    });

    logoutBtn.addEventListener('click', async () => {
        await supabase.auth.signOut();
        checkAuth();
    });

    async function checkAuth() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            loginScreen.classList.add('hidden');
            appScreen.classList.remove('hidden');
            appScreen.classList.add('fade-in');
            // Initialize app logic only after login
            initApp(); 
        } else {
            loginScreen.classList.remove('hidden');
            appScreen.classList.add('hidden');
        }
    }

    // Run auth check on load
    checkAuth();

    // ====== APP INITIALIZATION ======
    function initApp() {
        connectMQTT();
        fetchDevices();
    }

    window.setTime = (start, end) => {
        slotStartTime.value = start;
        slotEndTime.value = end;
    };

    // ====== AI PDF EXTRACTION LOGIC ======
        // Configure PDF.js worker
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    // ====== LOCAL PDF EXTRACTION LOGIC (NO API NEEDED) ======
    parsePdfBtn.addEventListener('click', async () => {
        const file = pdfUpload.files[0];
        if (!file) return alert("Please select a PDF file first.");
        
        pdfStatus.classList.remove('hidden', 'text-red-600');
        pdfStatus.classList.add('text-indigo-800');
        pdfStatus.innerText = "⏳ Reading PDF locally...";
        parsePdfBtn.disabled = true;

        try {
            const reader = new FileReader();
            reader.readAsArrayBuffer(file);
            reader.onload = async () => {
                const typedArray = new Uint8Array(reader.result);
                
                // Read PDF using PDF.js
                const pdf = await window.pdfjsLib.getDocument(typedArray).promise;
                let extractedText = "";
                
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    textContent.items.forEach(item => {
                        extractedText += item.str + " ";
                    });
                    extractedText += "\n";
                }

                // Clean up text and put it in the Bulk Paste area for the user to review
                // Replace multiple spaces with tabs or newlines to help the parser
                extractedText = extractedText.replace(/\s+/g, ' ').trim();
                
                if (extractedText.length > 0) {
                    // We will auto-parse it directly
                    parseExtractedText(extractedText);
                } else {
                    pdfStatus.classList.remove('text-indigo-800');
                    pdfStatus.classList.add('text-red-600');
                    pdfStatus.innerText = "❌ Could not extract text. Is this a scanned image PDF?";
                }
            };
        } catch (e) {
            console.error(e);
            pdfStatus.classList.remove('text-indigo-800');
            pdfStatus.classList.add('text-red-600');
            pdfStatus.innerText = `❌ Error reading PDF: ${e.message}`;
        } finally {
            parsePdfBtn.disabled = false;
        }
    });

    function parseExtractedText(text) {
        // Try to find patterns like "Monday 08:30 10:00 Math Smith A1"
        // This is a basic parser. It looks for Day names and times.
        const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        let addedCount = 0;
        
        // Split text into lines or chunks
        const lines = text.split('\n');
        
        lines.forEach(line => {
            days.forEach(day => {
                if (line.includes(day)) {
                    // Find times like 08:30 or 08h30
                    const timeMatches = line.match(/\b\d{1,2}[:h]\d{2}\b/gi);
                    if (timeMatches && timeMatches.length >= 2) {
                        let start = timeMatches[0].replace('h', ':').replace('H', ':');
                        let end = timeMatches[1].replace('h', ':').replace('H', ':');
                        
                        // Try to guess subject (words after the second time)
                        const parts = line.split(end);
                        let subject = parts[1] ? parts[1].trim().split(' ').slice(0, 3).join(' ') : "General";
                        subject = subject.replace(/[^a-zA-Z0-9\s]/g, '').trim();

                        if (scheduleData.schedule[day]) {
                            scheduleData.schedule[day].push({
                                start: start,
                                end: end,
                                subject: subject || "General",
                                professor: "",
                                section: ""
                            });
                            addedCount++;
                        }
                    }
                }
            });
        });

        if (addedCount > 0) {
            Object.keys(scheduleData.schedule).forEach(day => scheduleData.schedule[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)));
            renderPreview(); updateSendButton();
            pdfStatus.innerText = `✅ Success! Extracted and added ${addedCount} classes.`;
        } else {
            pdfStatus.classList.remove('text-indigo-800');
            pdfStatus.classList.add('text-red-600');
            pdfStatus.innerText = "❌ Could not auto-parse the schedule from the PDF text. Please use Manual Entry.";
        }
    }
    // ====== MQTT CONNECTION ======
    function connectMQTT() {
        mqttClient = new Paho.MQTT.Client(MQTT_HOST, MQTT_PORT, "web-client-" + Math.random().toString(16).substr(2, 8));
        mqttClient.onConnectionLost = () => { isConnected = false; updateStatus("Disconnected", "red"); };
        mqttClient.onMessageArrived = (message) => {
            const payload = JSON.parse(message.payloadString);
            if (payload.command === "$RALLResp") updateDeviceListUI(payload.devices);
        };
        const options = {
            useSSL: true, userName: MQTT_USER, password: MQTT_PASS,
            onSuccess: () => { 
                isConnected = true; 
                updateStatus("Online", "green"); 
                mqttClient.subscribe("raspberry/data_response"); 
            },
            onFailure: (err) => { 
                console.error("MQTT Connection Failed:", err); 
                updateStatus("Failed", "red"); 
            }
        };
        mqttClient.connect(options);
    }

    function updateStatus(text, color) {
        const el = document.getElementById('connectionStatus');
        if(el) {
            el.innerText = text;
            el.className = `px-3 py-1 rounded-full text-xs font-medium text-white ${color === 'green' ? 'bg-green-500' : color === 'red' ? 'bg-red-500' : 'bg-gray-500'}`;
        }
    }

    function updateDeviceListUI(devices) {
        deviceList.innerHTML = devices.map(d => `
            <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 flex justify-between items-center">
                <div>
                    <strong class="text-gray-800 text-sm">${d.module_id}</strong> <br>
                    <small class="text-gray-500">${d.node_name ? d.node_name : 'Device'}</small>
                </div>
                <span class="w-3 h-3 bg-green-500 rounded-full"></span>
            </div>
        `).join('');
        deviceSelect.innerHTML = '<option value="">-- Select Target Devices --</option>' + 
            devices.map(d => `<option value="${d.module_id}" data-type="${d.device_type}" data-network="${d.network}" data-nbm="${d.nbm}">${d.node_name || d.module_id}</option>`).join('');
    }

    async function fetchDevices() {
        if(!deviceList) return;
        deviceList.innerHTML = '<p class="text-gray-500 text-sm">Fetching devices...</p>';
        
        const defaultDevices = [
            { module_id: "esp32-classroom-111", node_name: "Classroom 111 ESP32", device_type: "esp32", network: "enit", nbm: "1" },
            { module_id: "pi-111", node_name: "Classroom 111 Raspberry Pi", device_type: "pi", network: "enit", nbm: "1" }
        ];
        updateDeviceListUI(defaultDevices);
    }

    function timeToMinutes(timeStr) { const [h, m] = timeStr.split(':').map(Number); return h * 60 + m; }
    function isOverlapping(sA, eA, sB, eB) { return (sA < eB) && (eA > sB); }

    window.deleteSlot = (day, index) => {
        scheduleData.schedule[day].splice(index, 1);
        renderPreview(); updateSendButton();
    };

    addSlotBtn.addEventListener('click', () => {
        const day = slotDay.value, startTime = slotStartTime.value, endTime = slotEndTime.value;
        const subject = slotSubject.value, professor = slotProfessor.value, section = slotSection.value;
        slotError.classList.add('hidden'); slotError.innerText = "";

        if (!day || !startTime || !endTime) return alert("Please select Day and Time");
        if (!subject) return alert("Please enter Subject");

        const startMin = timeToMinutes(startTime), endMin = timeToMinutes(endTime);
        if (startMin >= endMin) { slotError.innerText = "End time must be after Start time."; slotError.classList.remove('hidden'); return; }

        const duration = endMin - startMin;
        if (duration !== 60 && duration !== 90 && duration !== 180) {
            slotError.innerText = `Duration must be 1h, 1.5h, or 3h. (Current: ${duration} mins)`;
            slotError.classList.remove('hidden'); return;
        }

        let hasConflict = false;
        scheduleData.schedule[day].forEach(slot => {
            if (isOverlapping(startMin, endMin, timeToMinutes(slot.start), timeToMinutes(slot.end))) {
                hasConflict = true; slotError.innerText = `Conflict with ${slot.start} - ${slot.end}`; slotError.classList.remove('hidden');
            }
        });
        if (hasConflict) return alert("Cannot add class. Time conflict.");

        scheduleData.schedule[day].push({ start: startTime, end: endTime, subject, professor, section });
        scheduleData.schedule[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
        renderPreview(); updateSendButton();
    });

    resetScheduleBtn.addEventListener('click', () => {
        Object.keys(scheduleData.schedule).forEach(day => scheduleData.schedule[day] = []);
        renderPreview(); updateSendButton();
    });
    
    refreshBtn.addEventListener('click', fetchDevices);

    function renderPreview() {
        let html = '<div class="space-y-3">';
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].forEach(day => {
            const slots = scheduleData.schedule[day];
            html += `<div class="mb-2"><div class="flex justify-between items-center mb-1 border-b border-slate-200 pb-1"><strong class="text-blue-800 text-sm">${day}</strong><span class="text-xs font-medium ${slots.length > 0 ? 'text-blue-600' : 'text-gray-400'}">${slots.length} Slots</span></div>`;
            if (slots.length > 0) {
                html += `<div class="space-y-1">`;
                slots.forEach((slot, index) => {
                    html += `<div class="flex justify-between items-center bg-white p-2 rounded-md border border-slate-100 text-left">
                        <div class="flex-grow"><div class="font-semibold text-gray-800 text-sm"><span class="text-blue-600">${slot.start}</span> - <span class="text-red-500">${slot.end}</span> : ${slot.subject}</div><div class="text-xs text-gray-500 mt-1">${slot.professor} | ${slot.section}</div></div>
                        <button onclick="deleteSlot('${day}', ${index})" class="ml-2 text-gray-300 hover:text-red-500 transition p-1">❌</button>
                    </div>`;
                });
                html += `</div>`;
            } else { html += `<p class="text-gray-400 text-xs italic py-1">No slots</p>`; }
            html += `</div>`;
        });
        html += '</div>';
        previewArea.innerHTML = html;
    }

    function updateSendButton() {
        let total = 0;
        Object.values(scheduleData.schedule).forEach(d => total += d.length);
        sendScheduleBtn.disabled = total === 0;
        sendScheduleBtn.innerText = total > 0 ? `🚀 Send Schedule (${total} Slots)` : "Add Slots First";
    }

    sendScheduleBtn.addEventListener('click', async () => {
        const selectedOptions = Array.from(deviceSelect.selectedOptions);
        let total = 0; Object.values(scheduleData.schedule).forEach(d => total += d.length);

        if (selectedOptions.length === 0) return alert("Select at least one device");
        if (total === 0) return alert("No schedule data to send");
        if (!isConnected) return alert("MQTT offline");

        try {
            await supabase.from('schedules').upsert({ classroom_id: scheduleData.classroom, validity: scheduleData.validity, schedule_data: scheduleData.schedule });
            let sendCount = 0;
            
            for (const opt of selectedOptions) {
                const moduleId = opt.value, type = opt.getAttribute('data-type'); 
                let finalPayload = {}, topic = "";

                if (type === 'pi') {
                    topic = "classroom/111/schedule"; 
                    finalPayload = { classroom: scheduleData.classroom, validity: scheduleData.validity, schedule: scheduleData.schedule };
                } else {
                    const espDays = {};
                    Object.keys(scheduleData.schedule).forEach(day => {
                        espDays[day] = { events: {} };
                        scheduleData.schedule[day].forEach((slot, index) => {
                            espDays[day].events[(index + 1).toString()] = { startdate: slot.start, enddate: slot.end };
                        });
                    });
                    finalPayload = { command: "$SOMS", network: opt.getAttribute('data-network'), NBM: opt.getAttribute('data-nbm'), module_id: moduleId, scheduleData: { days: espDays } };
                    topic = "esp32-in/command";
                } 
                const message = new Paho.MQTT.Message(JSON.stringify(finalPayload));
                message.destinationName = topic;
                mqttClient.send(message);
                sendCount++;
            }
            alert(`Success! Schedule sent to ${sendCount} devices.`);
        } catch (e) { console.error(e); alert('Error sending schedule.'); } 
    });
});