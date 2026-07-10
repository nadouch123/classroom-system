document.addEventListener('DOMContentLoaded', () => {
    // ====== CONFIGURATION ======
    const SUPABASE_URL = "https://ioenxnbrggkcharfuvqq.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZW54bmJyZ2drY2hhcmZ1dnFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzA4NzgsImV4cCI6MjA5NjQwNjg3OH0.W6f8BWLvFeEoVinQUEwbKs9ckycvJamrYze5EmmmTHA";
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const MQTT_HOST = "8b3f08bad638441bb7bc39536961734b.s1.eu.hivemq.cloud";
    const MQTT_PORT = 8884; 
    const MQTT_USER = "enitAttendanceSystem";
    const MQTT_PASS = "enitAttendanceSystem123";
    
    const GROQ_API_KEY = "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";
    
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
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { 
            loginError.innerText = "Error: " + error.message; 
            loginError.classList.remove('hidden'); 
        } else { 
            loginError.classList.add('hidden'); 
            checkAuth(); 
        }
    });

    logoutBtn.addEventListener('click', async () => { await supabase.auth.signOut(); checkAuth(); });

    async function checkAuth() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) { 
            loginScreen.classList.add('hidden'); 
            appScreen.classList.remove('hidden'); 
            appScreen.classList.add('fade-in'); 
            initApp(); 
        } else { 
            loginScreen.classList.remove('hidden'); 
            appScreen.classList.add('hidden'); 
        }
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

    // ====== PDF VISUAL COORDINATE GRID + GROQ AI ======
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    parsePdfBtn.addEventListener('click', async () => {
        const file = pdfUpload.files[0];
        if (!file) return alert("Please select a PDF file first.");
        
        pdfStatus.classList.remove('hidden', 'text-red-600');
        pdfStatus.classList.add('text-indigo-800');
        pdfStatus.innerText = "⏳ Extracting visual grid...";
        parsePdfBtn.disabled = true;

        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        
        reader.onload = async () => {
            try {
                const typedArray = new Uint8Array(reader.result);
                const pdf = await window.pdfjsLib.getDocument(typedArray).promise;
                
                let gridText = "";

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    
                    let items = textContent.items.map(item => ({
                        str: item.str,
                        x: Math.round(item.transform[4]),
                        y: Math.round(item.transform[5]),
                        height: item.height || 10
                    }));

                    // Sort by Y descending (top to bottom), then X ascending (left to right)
                    items.sort((a, b) => {
                        if (a.y !== b.y) return b.y - a.y;
                        return a.x - b.x;
                    });

                    // Group into visual lines based on Y coordinates
                    let lines = [];
                    let currentY = null;
                    let currentLine = [];
                    
                    items.forEach(item => {
                        if (!item.str.trim()) return;
                        let yThreshold = item.height * 0.5;
                        
                        if (currentY === null || Math.abs(item.y - currentY) > yThreshold) {
                            if (currentLine.length > 0) lines.push({ y: currentY, items: currentLine });
                            currentLine = [];
                            currentY = item.y;
                        }
                        currentLine.push({ x: item.x, str: item.str });
                    });
                    if (currentLine.length > 0) lines.push({ y: currentY, items: currentLine });

                    gridText += `\n--- Page ${i} ---\n`;
                    lines.forEach(line => {
                        let lineStr = `Y=${line.y}: `;
                        line.items.forEach(item => {
                            lineStr += `[x=${item.x}] "${item.str}" `;
                        });
                        gridText += lineStr.trim() + "\n";
                    });
                }

                if (gridText.trim().length === 0) throw new Error("Could not extract any text from this PDF.");

                pdfStatus.innerText = "⏳ AI is reconstructing the schedule visually...";

                let prompt = `You are an expert OCR and schedule parsing AI. I have extracted text from a university schedule PDF. I have provided the X (horizontal) and Y (vertical) coordinates for each text fragment.
                - Y increases from bottom to top. (Higher Y is higher on the page).
                - X increases from left to right.
                - The schedule is a grid. Days (Lundi, Mardi, Mercredi, Jeudi, Vendredi, Samedi) are column headers. 
                - Times (08:00, 08:30, etc.) are on the far left.
                - A class cell spans vertically between two times. The text inside the cell may be split across multiple lines (wrapped text). You MUST merge these lines into a single class.
                
                Your task:
                1. Use the X coordinates to group texts into their respective Day columns. (Texts with similar X belong to the same column).
                2. Use the Y coordinates to group texts into rows/time slots. (Texts with similar Y belong to the same time slot).
                3. Reconstruct the classes. A class has a start time, end time, subject, professor, and section.
                4. The start time is the time on the far left that is aligned with the top of the cell. The end time is the next time marker in the timeline.
                5. If a class spans multiple hours, use the start of the first hour and the start of the next hour after the class ends.
                6. Extract the validity dates (Valable du... au...). Convert DD/MM/YYYY to YYYY-MM-DD.
                7. Translate French days to English (Lundi -> Monday).
                8. Ensure all times are strictly 24-hour format HH:MM.
                9. If a subject is split across multiple lines, merge them perfectly without adding extra commas.
                
                Here is the extracted data:
                ${gridText}
                
                Return a valid JSON object:
                {
                  "validity": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
                  "schedule": [
                    { "day": "Monday", "start": "HH:MM", "end": "HH:MM", "subject": "...", "professor": "...", "section": "..." }
                  ]
                }`;

                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${GROQ_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: [
                            { role: "system", content: "You are a JSON API. Respond ONLY with a valid JSON object. No markdown, no explanations." },
                            { role: "user", content: prompt }
                        ],
                        temperature: 0.1,
                        response_format: { type: "json_object" }
                    })
                });

                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error?.message || `API Error: ${response.status}`);
                }

                const data = await response.json();
                
                if (data.choices && data.choices.length > 0) {
                    let aiText = data.choices[0].message.content;
                    const aiResult = JSON.parse(aiText);
                    
                    if (aiResult.validity) {
                        if (aiResult.validity.from) validFrom.value = convertDateFormat(aiResult.validity.from);
                        if (aiResult.validity.to) validTo.value = convertDateFormat(aiResult.validity.to);
                    }

                    let addedCount = 0;
                    aiResult.schedule.forEach(cls => {
                        let dayRaw = cls.day ? cls.day.trim() : "";
                        let day = dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1).toLowerCase();
                        
                        if (scheduleData.schedule[day] && cls.subject && cls.subject.trim() !== "") {
                            scheduleData.schedule[day].push({
                                start: cls.start,
                                end: cls.end,
                                subject: cls.subject,
                                professor: cls.professor || "",
                                section: cls.section || ""
                            });
                            addedCount++;
                        }
                    });

                    Object.keys(scheduleData.schedule).forEach(day => scheduleData.schedule[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)));
                    renderPreview(); updateSendButton();
                    pdfStatus.innerText = `✅ Success! AI organized and added ${addedCount} classes.`;
                } else {
                    throw new Error("AI returned no data.");
                }
            } catch (e) {
                console.error("AI Extraction Error:", e);
                pdfStatus.classList.remove('text-indigo-800');
                pdfStatus.classList.add('text-red-600');
                pdfStatus.innerText = `❌ Error: ${e.message}`;
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
            onSuccess: () => { 
                isConnected = true; 
                updateStatus("Online", "green"); 
                mqttClient.subscribe("raspberry/data_response"); 
                fetchDevices(); 
            },
            onFailure: (err) => { 
                console.error("MQTT Failed:", err); 
                isConnected = false;
                updateStatus("Offline", "red"); 
                fetchDevices(); 
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
        if (!devices || devices.length === 0) {
            const fallbackDevices = [
                { module_id: "esp32-classroom-111", node_name: "Classroom 111 ESP32", device_type: "esp32", network: "enit", nbm: "1" },
                { module_id: "pi-111", node_name: "Classroom 111 Raspberry Pi", device_type: "pi", network: "enit", nbm: "1" }
            ];
            deviceList.innerHTML = fallbackDevices.map(d => `<div class="bg-slate-50 p-3 rounded-lg border border-slate-200"><strong>${d.module_id}</strong><br><small class="text-gray-500">Fallback Device (MQTT Offline)</small></div>`).join('');
            deviceSelect.innerHTML = '<option value="">-- Select --</option>' + fallbackDevices.map(d => `<option value="${d.module_id}" data-type="${d.device_type}" data-network="${d.network}" data-nbm="${d.nbm}">${d.node_name}</option>`).join('');
            return;
        }
        deviceList.innerHTML = devices.map(d => `<div class="bg-slate-50 p-3 rounded-lg border border-slate-200"><strong>${d.module_id}</strong></div>`).join('');
        deviceSelect.innerHTML = '<option value="">-- Select Target Devices --</option>' + devices.map(d => `<option value="${d.module_id}" data-type="${d.device_type}" data-network="${d.network}" data-nbm="${d.nbm}">${d.node_name || d.module_id}</option>`).join('');
    }

    async function fetchDevices() {
        if(isConnected) {
            const message = new Paho.MQTT.Message(JSON.stringify({ command: "$RALL" }));
            message.destinationName = "raspberry/data_request";
            mqttClient.send(message);
            setTimeout(() => { 
                if (deviceSelect.options.length <= 1) updateDeviceListUI([]); 
            }, 3000);
        } else { 
            updateDeviceListUI([]); 
        }
    }

    function timeToMinutes(timeStr) { 
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number); 
        return h * 60 + m; 
    }
    
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
            const { error: supabaseError } = await supabase.from('schedules').upsert({ 
                classroom_id: scheduleData.classroom, 
                validity: scheduleData.validity, 
                schedule_data: scheduleData.schedule 
            });
            
            if (supabaseError) throw new Error(`Database Error: ${supabaseError.message}`);

            if (!isConnected) {
                alert("⚠️ Schedule saved to database, but MQTT is disconnected. Cannot send to physical devices.");
                return;
            }

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
                        scheduleData.schedule[day].forEach((slot, index) => { 
                            espDays[day].events[(index + 1).toString()] = { 
                                startdate: slot.start, 
                                enddate: slot.end 
                            }; 
                        });
                    });
                    finalPayload = { 
                        command: "$SOMS", 
                        network: opt.getAttribute('data-network'), 
                        NBM: opt.getAttribute('data-nbm'), 
                        module_id: opt.value, 
                        scheduleData: { days: espDays } 
                    };
                    topic = "esp32-in/command";
                } 
                
                const message = new Paho.MQTT.Message(JSON.stringify(finalPayload));
                message.destinationName = topic;
                mqttClient.send(message);
            }
            alert("✅ Success! Schedule saved and sent to devices.");
        } catch (e) {
            console.error("Send Error:", e);
            alert(`❌ Error sending schedule: ${e.message}`); 
        } 
    });
});