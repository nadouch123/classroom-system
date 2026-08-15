document.addEventListener('DOMContentLoaded', () => {
    // ====== CONFIGURATION ======
    const SUPABASE_URL = "https://ioenxnbrggkcharfuvqq.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZW54bmJyZ2drY2hhcmZ1dnFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzA4NzgsImV4cCI6MjA5NjQwNjg3OH0.W6f8BWLvFeEoVinQUEwbKs9ckycvJamrYze5EmmmTHA";
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const MQTT_HOST = "8b3f08bad638441bb7bc39536961734b.s1.eu.hivemq.cloud";
    const MQTT_PORT = 8884; 
    const MQTT_USER = "enitAttendanceSystem";
    const MQTT_PASS = "enitAttendanceSystem123";
    
    // PASTE YOUR GOOGLE GEMINI API KEY HERE
    const GOOGLE_API_KEY = "AQ.Ab8RN6L4bU_O7Zpyvxpoytph5IZgFWOKb2zE3ynDKFyXvzW2AA";
    
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

    // ====== PDF FILE NAME DISPLAY ======
    pdfUpload.addEventListener('change', () => {
        const fileName = pdfUpload.files[0] ? pdfUpload.files[0].name : '';
        const fileNameEl = document.getElementById('fileName');
        const dropzoneText = document.getElementById('dropzoneText');
        
        if(fileName) {
            fileNameEl.innerText = fileName;
            dropzoneText.innerText = 'File ready! Click button above to extract.';
        } else {
            fileNameEl.innerText = '';
            dropzoneText.innerText = 'Drop PDF here or click to browse';
        }
    });

    // ====== GOOGLE GEMINI 3.5 FLASH NATIVE PDF EXTRACTION ======
    parsePdfBtn.addEventListener('click', async () => {
        const file = pdfUpload.files[0];
        if (!file) return alert("Please select a PDF file first.");
        
        pdfStatus.classList.remove('hidden', 'text-red-600');
        pdfStatus.classList.add('text-indigo-800');
        pdfStatus.innerText = "⏳ AI is reading the PDF...";
        parsePdfBtn.disabled = true;

        const reader = new FileReader();
        reader.readAsDataURL(file);
        
        reader.onload = async () => {
            try {
                const base64PDF = reader.result.split(',')[1];

                let prompt = `You are an expert schedule parser AI. I have attached a university schedule PDF.
                The schedule is a visual grid. Days (Monday to Saturday) are columns. Times (08:00, 09:00, etc.) are rows on the far left.
                Classes are inside grey/colored squares. 
                
                RULES:
                1. Look at the visual grid carefully. Read the text inside the squares.
                2. Extract validity dates from the metadata (Valable du... au...). Convert DD/MM/YYYY to YYYY-MM-DD.
                3. For each class, extract the day, exact start time, exact end time, subject, professor, and section.
                4. If a class square spans multiple time rows (e.g., from 17:30 to 20:00), use the earliest start time and the latest end time.
                5. If text wraps inside a square, merge it into a single subject string without adding commas.
                6. Do NOT invent classes. Only extract what you see in the squares.
                7. Ensure all times are strictly 24-hour format HH:MM.
                8. Translate French days to English (Lundi -> Monday).
                
                Return a valid JSON object:
                {
                  "validity": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
                  "schedule": [
                    { "day": "Monday", "start": "HH:MM", "end": "HH:MM", "subject": "...", "professor": "...", "section": "..." }
                  ]
                }`;

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GOOGLE_API_KEY}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: "application/pdf", data: base64PDF } }
                            ]
                        }],
                        generationConfig: {
                            temperature: 0.1,
                            response_mime_type: "application/json"
                        }
                    })
                });

                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error?.message || `API Error: ${response.status}`);
                }

                const data = await response.json();
                let aiText = data.candidates[0].content.parts[0].text;
                
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
                renderPreview(); 
                updateSendButton();
                pdfStatus.innerText = `✅ Success! AI organized and added ${addedCount} classes.`;
                
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
            
            // Handle device list response from server
            if (payload.command === "$RALLResp") {
                updateDeviceListUI(payload.devices);
                return;
            }
            
            // Handle real-time status changes — refresh device list immediately
            if (message.destinationName === "esp32-in/status" || message.destinationName === "classroom/111/pi_status") {
                console.log("📱 Device status changed, refreshing device list...");
                fetchDevices();
            }
        };
        
        const options = {
            useSSL: true, 
            userName: MQTT_USER, 
            password: MQTT_PASS,
            onSuccess: () => { 
                isConnected = true; 
                updateStatus("Online", "green"); 
                mqttClient.subscribe("raspberry/data_response"); 
                mqttClient.subscribe("esp32-in/status");          // ESP32 real-time status
                mqttClient.subscribe("classroom/111/pi_status");   // Pi real-time status
                fetchDevices(); 
                
                // Auto-refresh device list every 30 seconds as a fallback
                setInterval(() => { 
                    if (isConnected) fetchDevices(); 
                }, 30000);
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
            deviceList.innerHTML = `
                <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                    <p class="text-red-600 font-bold text-sm">⚠️ No devices online</p>
                    <p class="text-gray-500 text-xs mt-2">Make sure ESP32 and Raspberry Pi are powered on and connected to WiFi.</p>
                </div>`;
            deviceSelect.innerHTML = '<option value="">-- No Devices Online --</option>';
            return;
        }
        
        deviceList.innerHTML = devices.map(d => `
            <div class="bg-green-50 p-3 rounded-lg border border-green-200 flex justify-between items-center">
                <div>
                    <strong class="text-gray-800">${d.module_id}</strong><br>
                    <small class="text-gray-500">${(d.device_type || '').toUpperCase()} | Network: ${d.network || 'enit'}</small>
                </div>
                <span class="px-2 py-1 rounded-full text-xs font-bold text-white bg-green-500">ONLINE</span>
            </div>
        `).join('');
        
        deviceSelect.innerHTML = '<option value="">-- Select Target Devices --</option>' + 
            devices.map(d => `<option value="${d.module_id}" data-type="${d.device_type}" data-network="${d.network}" data-nbm="${d.nbm}">${d.node_name || d.module_id}</option>`).join('');
    }

    async function fetchDevices() {
        if(isConnected) {
            const message = new Paho.MQTT.Message(JSON.stringify({ command: "$RALL" }));
            message.destinationName = "raspberry/data_request";
            mqttClient.send(message);
            
            // Fallback in case server doesn't respond
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
    
    window.deleteSlot = (day, index) => { 
        scheduleData.schedule[day].splice(index, 1); 
        renderPreview(); 
        updateSendButton(); 
    };

    // EDIT SLOT LOGIC - Loads slot data back into the form
    window.editSlot = (day, index) => {
        const slot = scheduleData.schedule[day][index];
        
        // Load values into the form inputs
        slotDay.value = day;
        slotStartTime.value = slot.start;
        slotEndTime.value = slot.end;
        slotSubject.value = slot.subject;
        slotProfessor.value = slot.professor;
        slotSection.value = slot.section;
        
        // Remove the old slot so we can save the updated one
        scheduleData.schedule[day].splice(index, 1);
        renderPreview();
        updateSendButton();
        
        // Scroll up to the form so the user can edit
        document.getElementById('addSlotBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
        slotSubject.focus(); // Put cursor in subject box
    };

    addSlotBtn.addEventListener('click', () => {
        const day = slotDay.value, startTime = slotStartTime.value, endTime = slotEndTime.value;
        const subject = slotSubject.value, professor = slotProfessor.value, section = slotSection.value;
        if (!day || !startTime || !endTime || !subject) return alert("Missing fields");
        scheduleData.schedule[day].push({ start: startTime, end: endTime, subject, professor, section });
        scheduleData.schedule[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
        renderPreview(); 
        updateSendButton();
        
        // Clear subject field for faster entry
        slotSubject.value = '';
        slotSubject.focus();
    });

    resetScheduleBtn.addEventListener('click', () => { 
        Object.keys(scheduleData.schedule).forEach(day => scheduleData.schedule[day] = []); 
        renderPreview(); 
        updateSendButton(); 
    });
    
    refreshBtn.addEventListener('click', fetchDevices);

    // MODERN SCHEDULE PREVIEW RENDER
    function renderPreview() {
        let html = '<div class="space-y-4">';
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].forEach(day => {
            const slots = scheduleData.schedule[day];
            
            // Modern Day Container
            html += `<div class="bg-slate-50 rounded-xl p-3 border border-slate-200">`;
            html += `<div class="flex justify-between items-center mb-2 border-b border-slate-300 pb-2">
                        <strong class="text-indigo-800 text-md font-bold">${day}</strong>
                        <span class="text-xs font-bold ${slots.length > 0 ? 'text-indigo-600 bg-indigo-100 px-2 py-1 rounded-full' : 'text-gray-400 bg-gray-100 px-2 py-1 rounded-full'}">${slots.length} Slots</span>
                     </div>`;
            
            if (slots.length > 0) {
                html += `<div class="space-y-2">`;
                slots.forEach((slot, index) => {
                    // Modern Slot Card with Edit/Delete buttons
                    html += `
                    <div class="flex justify-between items-center bg-white p-3 rounded-lg shadow-sm border border-slate-100 hover:border-indigo-300 transition group">
                        <div class="flex-grow">
                            <div class="flex items-center space-x-2 mb-1">
                                <span class="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md text-xs font-bold">${slot.start}</span>
                                <span class="text-gray-300 text-xs">→</span>
                                <span class="text-red-500 bg-red-50 px-2 py-0.5 rounded-md text-xs font-bold">${slot.end}</span>
                            </div>
                            <div class="font-semibold text-gray-900 text-sm">${slot.subject}</div>
                            <div class="text-xs text-gray-500 mt-1 flex gap-3">
                                <span>👤 ${slot.professor || 'N/A'}</span> 
                                <span>🎓 ${slot.section || 'N/A'}</span>
                            </div>
                        </div>
                        <div class="flex flex-col gap-1 ml-2 opacity-0 group-hover:opacity-100 transition">
                            <button onclick="editSlot('${day}', ${index})" class="text-blue-500 hover:bg-blue-50 p-1.5 rounded-md transition" title="Edit Slot">✏️</button>
                            <button onclick="deleteSlot('${day}', ${index})" class="text-red-500 hover:bg-red-50 p-1.5 rounded-md transition" title="Delete Slot">🗑️</button>
                        </div>
                    </div>`;
                });
                html += `</div>`;
            } else { 
                html += `<p class="text-gray-400 text-xs italic py-2 text-center">No classes scheduled</p>`; 
            }
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

    // SEND SCHEDULE LOGIC
    sendScheduleBtn.addEventListener('click', async () => {
        const selectedOptions = Array.from(deviceSelect.selectedOptions);
        let total = 0; Object.values(scheduleData.schedule).forEach(d => total += d.length);
        if (selectedOptions.length === 0 || total === 0) return alert("Select device and add slots");

        scheduleData.validity.from = validFrom.value;
        scheduleData.validity.to = validTo.value;

        try {
            // FIX: Added { onConflict: 'classroom_id' } so it updates instead of throwing duplicate error
            const { error: supabaseError } = await supabase.from('schedules').upsert({ 
                classroom_id: scheduleData.classroom, 
                validity: scheduleData.validity, 
                schedule_data: scheduleData.schedule 
            }, { onConflict: 'classroom_id' });
            
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