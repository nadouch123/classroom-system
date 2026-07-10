document.addEventListener('DOMContentLoaded', () => {
    // ====== CONFIGURATION ======
    const SUPABASE_URL = "https://ioenxnbrggkcharfuvqq.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZW54bmJyZ2drY2hhcmZ1dnFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzA4NzgsImV4cCI6MjA5NjQwNjg3OH0.W6f8BWLvFeEoVinQUEwbKs9ckycvJamrYze5EmmmTHA";
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const MQTT_HOST = "8b3f08bad638441bb7bc39536961734b.s1.eu.hivemq.cloud";
    const MQTT_PORT = 8884; 
    const MQTT_USER = "enitAttendanceSystem";
    const MQTT_PASS = "enitAttendanceSystem123";
    
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
        if(!email || !password) return loginError.innerText = "Please enter email and password", loginError.classList.remove('hidden');
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { loginError.innerText = "Error: " + error.message; loginError.classList.remove('hidden'); } 
        else { loginError.classList.add('hidden'); checkAuth(); }
    });

    logoutBtn.addEventListener('click', async () => { await supabase.auth.signOut(); checkAuth(); });

    async function checkAuth() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) { loginScreen.classList.add('hidden'); appScreen.classList.remove('hidden'); appScreen.classList.add('fade-in'); initApp(); } 
        else { loginScreen.classList.remove('hidden'); appScreen.classList.add('hidden'); }
    }
    checkAuth();

    function initApp() { connectMQTT(); }

    window.setTime = (start, end) => { slotStartTime.value = start; slotEndTime.value = end; };

    function convertDateFormat(dateStr) {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        return dateStr;
    }

          // ====== PDF IMAGE EXTRACTION + GEMINI VISION AI ======
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    parsePdfBtn.addEventListener('click', async () => {
        const file = pdfUpload.files[0];
        if (!file) return alert("Please select a PDF file first.");
        
        pdfStatus.classList.remove('hidden', 'text-red-600');
        pdfStatus.classList.add('text-indigo-800');
        pdfStatus.innerText = "⏳ Converting PDF to image...";
        parsePdfBtn.disabled = true;

        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        
        reader.onload = async () => {
            try {
                // 1. Render PDF page to an Image (Canvas)
                const typedArray = new Uint8Array(reader.result);
                const pdf = await window.pdfjsLib.getDocument(typedArray).promise;
                const page = await pdf.getPage(1);
                
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                await page.render({ canvasContext: context, viewport: viewport }).promise;
                const imgDataUrl = canvas.toDataURL('image/png');

                if (typeof puter === 'undefined') {
                    throw new Error("Puter.js is not loaded! Check index.html.");
                }

                pdfStatus.innerText = "⏳ AI is reading the image... (Please wait 15s)";

                // 2. Send Image to Gemini 2.0 Flash via Puter.js
                const prompt = `You are an expert university schedule parser. Analyze the provided image of a schedule PDF (it is in French).
                
                CRITICAL INSTRUCTIONS:
                1. The image is a table. Days are columns (Lundi, Mardi, Mercredi, Jeudi, Vendredi, Samedi). Times are rows.
                2. Translate the days to English (Monday, Tuesday, Wednesday, Thursday, Friday, Saturday).
                3. Extract the "Valable du" (from) and "au" (to) dates in YYYY-MM-DD format.
                4. For each class, extract the exact start and end time (HH:MM), subject, professor, and section.
                5. Do not invent classes. Only extract what is visibly written in the table.
                
                Return ONLY a valid JSON object with this exact structure:
                {
                  "validity": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
                  "schedule": [
                    { "day": "Monday", "start": "HH:MM", "end": "HH:MM", "subject": "...", "professor": "...", "section": "..." }
                  ]
                }`;

                const response = await puter.ai.chat(prompt, imgDataUrl, { model: "gemini-2.0-flash" });
                
                let aiText = "";
                if (typeof response === 'string') aiText = response;
                else if (response?.message?.content) aiText = typeof response.message.content === 'string' ? response.message.content : response.message.content.map(p => p.text).join('');
                else if (response?.text) aiText = response.text;
                else aiText = JSON.stringify(response);

                aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
                const jsonStart = aiText.indexOf('{');
                const jsonEnd = aiText.lastIndexOf('}');
                
                if (jsonStart === -1 || jsonEnd === -1) {
                    throw new Error("AI did not return valid JSON. Response was: " + aiText.substring(0, 100));
                }

                const aiResult = JSON.parse(aiText.substring(jsonStart, jsonEnd + 1));
                
                // 3. Apply validity dates
                if (aiResult.validity) {
                    if (aiResult.validity.from) validFrom.value = convertDateFormat(aiResult.validity.from);
                    if (aiResult.validity.to) validTo.value = convertDateFormat(aiResult.validity.to);
                }

                // 4. Add to schedule
                let addedCount = 0;
                aiResult.schedule.forEach(cls => {
                    let day = cls.day.charAt(0).toUpperCase() + cls.day.slice(1).toLowerCase();
                    if (scheduleData.schedule[day]) {
                        scheduleData.schedule[day].push({
                            start: cls.start, end: cls.end,
                            subject: cls.subject || "General",
                            professor: cls.professor || "",
                            section: cls.section || ""
                        });
                        addedCount++;
                    }
                });

                Object.keys(scheduleData.schedule).forEach(day => scheduleData.schedule[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)));
                renderPreview(); updateSendButton();
                pdfStatus.innerText = `✅ Success! AI organized and added ${addedCount} classes.`;
                
            } catch (e) {
                console.error("AI Vision Error:", e);
                pdfStatus.classList.remove('text-indigo-800');
                pdfStatus.classList.add('text-red-600');
                // Display the exact error message
                let errMsg = e?.message || e?.error?.message || JSON.stringify(e);
                pdfStatus.innerText = `❌ Error: ${errMsg}`;
            } finally {
                parsePdfBtn.disabled = false;
            }
        };
    });
    // ====== MQTT CONNECTION & UI LOGIC ======
    function connectMQTT() {
        mqttClient = new Paho.MQTT.Client(MQTT_HOST, MQTT_PORT, "web-client-" + Math.random().toString(16).substr(2, 8));
        mqttClient.onConnectionLost = () => { isConnected = false; updateStatus("Disconnected", "red"); };
        mqttClient.onMessageArrived = (message) => {
            const payload = JSON.parse(message.payloadString);
            if (payload.command === "$RALLResp") updateDeviceListUI(payload.devices);
        };
        const options = {
            useSSL: true, userName: MQTT_USER, password: MQTT_PASS,
            onSuccess: () => { isConnected = true; updateStatus("Online", "green"); mqttClient.subscribe("raspberry/data_response"); fetchDevices(); },
            onFailure: (err) => { console.error("MQTT Failed:", err); updateStatus("Failed", "red"); fetchDevices(); }
        };
        mqttClient.connect(options);
    }

    function updateStatus(text, color) {
        const el = document.getElementById('connectionStatus');
        if(el) el.className = `px-3 py-1 rounded-full text-xs font-medium text-white ${color === 'green' ? 'bg-green-500' : color === 'red' ? 'bg-red-500' : 'bg-gray-500'}`;
    }

    function updateDeviceListUI(devices) {
        if (!devices || devices.length === 0) {
            const fallbackDevices = [
                { module_id: "esp32-classroom-111", node_name: "Classroom 111 ESP32", device_type: "esp32", network: "enit", nbm: "1" },
                { module_id: "pi-111", node_name: "Classroom 111 Raspberry Pi", device_type: "pi", network: "enit", nbm: "1" }
            ];
            deviceList.innerHTML = fallbackDevices.map(d => `<div class="bg-slate-50 p-3 rounded-lg border border-slate-200"><strong>${d.module_id}</strong></div>`).join('');
            deviceSelect.innerHTML = '<option value="">-- Select --</option>' + fallbackDevices.map(d => `<option value="${d.module_id}" data-type="${d.device_type}" data-network="${d.network}" data-nbm="${d.nbm}">${d.node_name}</option>`).join('');
            return;
        }
        deviceSelect.innerHTML = '<option value="">-- Select Target Devices --</option>' + devices.map(d => `<option value="${d.module_id}" data-type="${d.device_type}" data-network="${d.network}" data-nbm="${d.nbm}">${d.node_name || d.module_id}</option>`).join('');
    }

    async function fetchDevices() {
        if(isConnected) {
            const message = new Paho.MQTT.Message(JSON.stringify({ command: "$RALL" }));
            message.destinationName = "raspberry/data_request";
            mqttClient.send(message);
            setTimeout(() => { if (!deviceSelect.options.length > 1) updateDeviceListUI([]); }, 3000);
        } else { updateDeviceListUI([]); }
    }

    function timeToMinutes(timeStr) { const [h, m] = timeStr.split(':').map(Number); return h * 60 + m; }
    window.deleteSlot = (day, index) => { scheduleData.schedule[day].splice(index, 1); renderPreview(); updateSendButton(); };

    addSlotBtn.addEventListener('click', () => {
        const day = slotDay.value, startTime = slotStartTime.value, endTime = slotEndTime.value;
        const subject = slotSubject.value, professor = slotProfessor.value, section = slotSection.value;
        if (!day || !startTime || !endTime || !subject) return alert("Missing fields");
        scheduleData.schedule[day].push({ start: startTime, end: endTime, subject, professor, section });
        scheduleData.schedule[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
        renderPreview(); updateSendButton();
    });

    resetScheduleBtn.addEventListener('click', () => { Object.keys(scheduleData.schedule).forEach(day => scheduleData.schedule[day] = []); renderPreview(); updateSendButton(); });
    refreshBtn.addEventListener('click', fetchDevices);

    function renderPreview() {
        let html = '<div class="space-y-3">';
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].forEach(day => {
            const slots = scheduleData.schedule[day];
            html += `<div class="mb-2"><div class="flex justify-between items-center mb-1 border-b border-slate-200 pb-1"><strong class="text-blue-800 text-sm">${day}</strong><span class="text-xs font-medium ${slots.length > 0 ? 'text-blue-600' : 'text-gray-400'}">${slots.length} Slots</span></div>`;
            if (slots.length > 0) {
                html += `<div class="space-y-1">`;
                slots.forEach((slot, index) => {
                    html += `<div class="flex justify-between items-center bg-white p-2 rounded-md border border-slate-100 text-left"><div class="flex-grow"><div class="font-semibold text-gray-800 text-sm"><span class="text-blue-600">${slot.start}</span> - <span class="text-red-500">${slot.end}</span> : ${slot.subject}</div><div class="text-xs text-gray-500 mt-1">${slot.professor} | ${slot.section}</div></div><button onclick="deleteSlot('${day}', ${index})" class="ml-2 text-gray-300 hover:text-red-500 transition p-1">❌</button></div>`;
                });
                html += `</div>`;
            } else { html += `<p class="text-gray-400 text-xs italic py-1">No slots</p>`; }
            html += `</div>`;
        });
        html += '</div>';
        previewArea.innerHTML = html;
    }

    function updateSendButton() {
        let total = 0; Object.values(scheduleData.schedule).forEach(d => total += d.length);
        sendScheduleBtn.disabled = total === 0;
        sendScheduleBtn.innerText = total > 0 ? `🚀 Send Schedule (${total} Slots)` : "Add Slots First";
    }

    sendScheduleBtn.addEventListener('click', async () => {
        const selectedOptions = Array.from(deviceSelect.selectedOptions);
        let total = 0; Object.values(scheduleData.schedule).forEach(d => total += d.length);
        if (selectedOptions.length === 0 || total === 0) return alert("Select device and add slots");

        scheduleData.validity.from = validFrom.value;
        scheduleData.validity.to = validTo.value;

        try {
            await supabase.from('schedules').upsert({ classroom_id: scheduleData.classroom, validity: scheduleData.validity, schedule_data: scheduleData.schedule });
            for (const opt of selectedOptions) {
                const type = opt.getAttribute('data-type'); 
                let finalPayload = {}, topic = "";
                if (type === 'pi') {
                    topic = "classroom/111/schedule"; 
                    finalPayload = { classroom: scheduleData.classroom, validity: scheduleData.validity, schedule: scheduleData.schedule };
                } else {
                    const espDays = {};
                    Object.keys(scheduleData.schedule).forEach(day => {
                        espDays[day] = { events: {} };
                        scheduleData.schedule[day].forEach((slot, index) => { espDays[day].events[(index + 1).toString()] = { startdate: slot.start, enddate: slot.end }; });
                    });
                    finalPayload = { command: "$SOMS", network: opt.getAttribute('data-network'), NBM: opt.getAttribute('data-nbm'), module_id: opt.value, scheduleData: { days: espDays } };
                    topic = "esp32-in/command";
                } 
                const message = new Paho.MQTT.Message(JSON.stringify(finalPayload));
                message.destinationName = topic;
                mqttClient.send(message);
            }
            alert("Success! Schedule sent.");
        } catch (e) { alert('Error sending schedule.'); } 
    });
});