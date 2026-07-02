document.addEventListener('DOMContentLoaded', () => {
    // ====== CONFIGURATION ======
    const SUPABASE_URL = "https://ioenxnbrggkcharfuvqq.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZW54bmJyZ2drY2hhcmZ1dnFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzA4NzgsImV4cCI6MjA5NjQwNjg3OH0.W6f8BWLvFeEoVinQUEwbKs9ckycvJamrYze5EmmmTHA";
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const MQTT_HOST = "8b3f08bad638441bb7bc39536961734b.s1.eu.hivemq.cloud";
    const MQTT_PORT = 8884; 
    const MQTT_USER = "enitAttendanceSystem";
    const MQTT_PASS = "enitAttendanceSystem123";
    
    // METTEZ VOTRE CLÉ GROQ ICI (commence par gsk_)
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
            initApp(); 
        } else {
            loginScreen.classList.remove('hidden');
            appScreen.classList.add('hidden');
        }
    }
    checkAuth();

    // ====== APP INITIALIZATION ======
    function initApp() {
        connectMQTT();
    }

    window.setTime = (start, end) => {
        slotStartTime.value = start;
        slotEndTime.value = end;
    };

            // ====== PDF EXTRACTION + GROQ AI ======
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    parsePdfBtn.addEventListener('click', async () => {
        const file = pdfUpload.files[0];
        if (!file) return alert("Please select a PDF file first.");
        
        pdfStatus.classList.remove('hidden', 'text-red-600');
        pdfStatus.classList.add('text-indigo-800');
        pdfStatus.innerText = "⏳ Reading PDF and asking AI to organize it...";
        parsePdfBtn.disabled = true;

        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        
        reader.onload = async () => {
            try {
                // 1. Extract raw text
                const typedArray = new Uint8Array(reader.result);
                const pdf = await window.pdfjsLib.getDocument(typedArray).promise;
                let rawText = "";
                
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    textContent.items.forEach(item => { rawText += item.str + " "; });
                    rawText += "\n";
                }

                if (rawText.length === 0) throw new Error("Could not extract any text from this PDF.");

                // Check if API key is set
                if (GROQ_API_KEY === "gsk_VOTRE_CLE_ICI" || !GROQ_API_KEY) {
                    throw new Error("Groq API Key is missing! Please add your gsk_ key in app.js");
                }

                // 2. Send to Groq AI
                const prompt = `You are a university schedule parser. Analyze the following raw text extracted from a schedule PDF. 
                Return ONLY a valid JSON array of objects. 
                Each object must have exactly these keys: "day" (Monday, Tuesday, etc.), "start" (HH:MM), "end" (HH:MM), "subject", "professor", "section". 
                Do not include markdown formatting or extra text.
                
                Raw Text:
                ${rawText}`;

                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${GROQ_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.1
                    })
                });

                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error?.message || `API Error: ${response.status}`);
                }

                const data = await response.json();
                
                if (data.choices && data.choices.length > 0) {
                    let aiText = data.choices[0].message.content;
                    
                    // Robust JSON extraction (in case AI adds extra text)
                    const jsonStart = aiText.indexOf('[');
                    const jsonEnd = aiText.lastIndexOf(']');
                    if (jsonStart === -1 || jsonEnd === -1) {
                        throw new Error("AI did not return valid JSON.");
                    }
                    const jsonString = aiText.substring(jsonStart, jsonEnd + 1);
                    const parsedClasses = JSON.parse(jsonString);
                    
                    // 3. Add to schedule
                    let addedCount = 0;
                    parsedClasses.forEach(cls => {
                        let day = cls.day.charAt(0).toUpperCase() + cls.day.slice(1).toLowerCase();
                        if (scheduleData.schedule[day]) {
                            scheduleData.schedule[day].push({
                                start: cls.start,
                                end: cls.end,
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
                fetchDevices(); 
            },
            onFailure: (err) => { 
                console.error("MQTT Connection Failed:", err); 
                updateStatus("Failed", "red"); 
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
            deviceList.innerHTML = '<p class="text-gray-500 text-sm">No devices found.</p>';
            deviceSelect.innerHTML = '<option value="">No devices available</option>';
            return;
        }

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
        deviceList.innerHTML = '<p class="text-gray-500 text-sm">Searching for devices...</p>';
        
        const message = new Paho.MQTT.Message(JSON.stringify({ command: "$RALL" }));
        message.destinationName = "raspberry/data_request";
        
        if(isConnected) {
            mqttClient.send(message);
            setTimeout(() => {
                if (deviceList.innerHTML.includes('Searching')) {
                    updateDeviceListUI([]);
                }
            }, 3000);
        } else {
            updateDeviceListUI([]);
        }
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