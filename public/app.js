document.addEventListener('DOMContentLoaded', () => {
    // ====== CONFIGURATION ======
    const SUPABASE_URL = "https://ioenxnbrggkcharfuvqq.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZW54bmJyZ2drY2hhcmZ1dnFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzA4NzgsImV4cCI6MjA5NjQwNjg3OH0.W6f8BWLvFeEoVinQUEwbKs9ckycvJamrYze5EmmmTHA";
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const MQTT_HOST = "8b3f08bad638441bb7bc39536961734b.s1.eu.hivemq.cloud";
    const MQTT_PORT = 8884;  // <--- CHANGED TO 8884 FOR WEB BROWSERS
    const MQTT_USER = "enitAttendanceSystem";
    const MQTT_PASS = "enitAttendanceSystem123";

    const API_KEY = process.env.GCP_API_KEY;
    
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
    const deviceSelect = document.getElementById('deviceSelect');
    const sendScheduleBtn = document.getElementById('sendSchedule');
    const uploadStatus = document.getElementById('uploadStatus');
    const deviceList = document.getElementById('deviceList');
    const refreshBtn = document.getElementById('refreshDevices');
    
    const classroomId = document.getElementById('classroomId');
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

    window.setTime = (start, end) => {
        slotStartTime.value = start;
        slotEndTime.value = end;
    };

        // ====== AI PDF EXTRACTION LOGIC ======
    parsePdfBtn.addEventListener('click', async () => {
        const file = pdfUpload.files[0];
        if (!file) return alert("Please select a PDF file first.");
        
        pdfStatus.classList.remove('hidden');
        pdfStatus.innerText = "⏳ AI is reading the PDF... Please wait (10-15 seconds).";
        parsePdfBtn.disabled = true;

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64Data = reader.result.split(',')[1];
            const prompt = `Analyze this university schedule document. Extract all class sessions. 
            Return ONLY a valid JSON array of objects. 
            Each object must have exactly these keys: "day" (e.g. Monday), "start" (HH:MM 24h format), "end" (HH:MM 24h format), "subject", "professor", "section". 
            If a field is missing, use an empty string "". Do not include markdown formatting like \`\`\`json.`;

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: "application/pdf", data: base64Data } } ] }]
                    })
                });

                const data = await response.json();
                console.log("Google API Response:", data); // Log full response
                
                // Check if Google returned an error object
                if (data.error) {
                    throw new Error(data.error.message || "Unknown API Error");
                }

                if (data.candidates && data.candidates.length > 0) {
                    let aiText = data.candidates[0].content.parts[0].text;
                    aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
                    const parsedClasses = JSON.parse(aiText);
                    
                    let addedCount = 0;
                    parsedClasses.forEach(cls => {
                        let day = cls.day.charAt(0).toUpperCase() + cls.day.slice(1).toLowerCase();
                        if (scheduleData.schedule[day]) {
                            scheduleData.schedule[day].push({ start: cls.start, end: cls.end, subject: cls.subject || "General", professor: cls.professor || "", section: cls.section || "" });
                            addedCount++;
                        }
                    });

                    Object.keys(scheduleData.schedule).forEach(day => scheduleData.schedule[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)));
                    renderPreview(); updateSendButton();
                    pdfStatus.innerText = `✅ Success! AI extracted and added ${addedCount} classes.`;
                } else {
                    throw new Error("AI returned no candidates. The PDF might be empty or unreadable.");
                }
            } catch (e) {
                console.error(e);
                // Show the exact error message on the screen!
                pdfStatus.innerText = `❌ Error: ${e.message}`;
                pdfStatus.classList.add('text-red-600');
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
            }
        };
        mqttClient.connect(options);
    }

    function updateStatus(text, color) {
        const el = document.getElementById('connectionStatus');
        if(el) {
            el.innerText = text;
            el.className = `px-2 py-1 rounded text-white text-sm ${color === 'green' ? 'bg-green-500' : color === 'red' ? 'bg-red-500' : 'bg-gray-500'}`;
        }
    }

    function updateDeviceListUI(devices) {
        deviceList.innerHTML = devices.map(d => `
            <div class="bg-white p-4 rounded-lg shadow-md border border-gray-200 mb-2">
                <strong>ID:</strong> ${d.module_id} <br>
                <small class="text-gray-500">${d.node_name ? `Name: ${d.node_name}` : ''}</small>
            </div>
        `).join('');
        deviceSelect.innerHTML = '<option value="">-- Select Target Devices --</option>' + 
            devices.map(d => `<option value="${d.module_id}" data-type="${d.device_type}" data-network="${d.network}" data-nbm="${d.nbm}">${d.node_name || d.module_id}</option>`).join('');
    }

    async function fetchDevices() {
        if(!deviceList) return;
        deviceList.innerHTML = '<p class="text-gray-500">Fetching devices...</p>';
        
        // Fallback: Add default ESP32 manually so you can always send schedules
        const defaultDevices = [
            { module_id: "esp32-classroom-111", node_name: "Classroom 111 ESP32", device_type: "esp32", network: "enit", nbm: "1" },
            { module_id: "pi-111", node_name: "Classroom 111 Raspberry Pi", device_type: "pi", network: "enit", nbm: "1" }
        ];
        updateDeviceListUI(defaultDevices);

        // Also try to request from server
        const message = new Paho.MQTT.Message(JSON.stringify({ command: "$RALL" }));
        message.destinationName = "raspberry/data_request";
        if(isConnected) mqttClient.send(message);
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
        let html = '<div class="space-y-2">';
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].forEach(day => {
            const slots = scheduleData.schedule[day];
            html += `<div class="flex justify-between items-center mb-1 border-b border-gray-200 pb-1 mt-2"><strong class="text-blue-900">${day}</strong><span class="text-xs font-bold ${slots.length > 0 ? 'text-blue-600' : 'text-gray-400'}">${slots.length} Slots</span></div>`;
            if (slots.length > 0) {
                html += `<div class="grid grid-cols-1 gap-1">`;
                slots.forEach((slot, index) => {
                    html += `<div class="flex justify-between items-center bg-white p-2 rounded shadow-sm border border-gray-100 text-left group">
                        <div class="flex-grow"><div class="font-bold text-gray-800 text-sm"><span class="text-blue-600">${slot.start}</span> - <span class="text-red-500">${slot.end}</span> : ${slot.subject}</div><div class="text-xs text-gray-500 mt-1">${slot.professor} | ${slot.section}</div></div>
                        <button onclick="deleteSlot('${day}', ${index})" class="ml-2 text-gray-300 hover:text-red-500 transition-colors p-1">❌</button>
                    </div>`;
                });
                html += `</div>`;
            } else { html += `<p class="text-gray-400 text-xs italic py-1">No slots</p>`; }
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
            updateStatus(`Sent to ${sendCount} devices!`, 'green');
        } catch (e) { console.error(e); updateStatus('Error sending', 'red'); } 
    });

    // Init
    connectMQTT();
});