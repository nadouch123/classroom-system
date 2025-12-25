document.addEventListener('DOMContentLoaded', () => {
    // ====== CONFIGURATION ======
    const SUPABASE_URL = "https://wmslmgdgxfogaftdweio.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indtc2xtZ2RneGZvZ2FmdGR3ZWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNTcwNzUsImV4cCI6MjA4MTYzMzA3NX0.nsi5Uv8fiw1c1j2pavQvnPeGHZoHHO0GiS6A1fmmt3c"; // Paste full key
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // MQTT Config
    const MQTT_HOST = "8b3f08bad638441bb7bc39536961734b.s1.eu.hivemq.cloud";
    const MQTT_PORT = 8884; 
    const MQTT_USER = "enitAttendanceSystem";
    const MQTT_PASS = "enitAttendanceSystem123";
    
    let mqttClient;
    let isConnected = false;
    
    // Schedule Data Structure
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
    
    // Builder Elements
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
    const slotError = document.getElementById('slotError'); // Error display

    // ====== MQTT CONNECTION ======
    function connectMQTT() {
        mqttClient = new Paho.MQTT.Client(MQTT_HOST, MQTT_PORT, "web-client-" + Math.random().toString(16).substr(2, 8));
        
        mqttClient.onConnectionLost = () => {
            console.log("MQTT Lost");
            isConnected = false;
            updateStatus("Disconnected", "red");
        };
        
        mqttClient.onMessageArrived = (message) => {
            console.log("Web App Received:", message.payloadString);
            const payload = JSON.parse(message.payloadString);
            if (payload.respons === "$RDNM") {
                console.log("Device discovered:", payload.module_id);
                fetchDevices(); 
            }
            if (payload.command === "$RALLResp") {
                console.log("Received device list:", payload.devices);
                updateDeviceListUI(payload.devices);
            }
        };

        const options = {
            useSSL: true,
            userName: MQTT_USER,
            password: MQTT_PASS,
            onSuccess: () => {
                console.log("MQTT Connected");
                isConnected = true;
                updateStatus("Online", "green");
                mqttClient.subscribe("raspberry/data_response"); 
            },
            onFailure: () => {
                console.log("MQTT Failed");
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

    // Helper to update device list
    function updateDeviceListUI(devices) {
        deviceList.innerHTML = devices.map(d => `
            <div class="bg-white p-4 rounded-lg shadow-md border border-gray-200 mb-2">
                <div class="flex justify-between items-center">
                    <div>
                        <strong>ID:</strong> ${d.module_id} <br>
                        <small class="text-gray-500">
                            ${d.node_name ? `Name: ${d.node_name}` : ''} <br>
                            ${d.node_address ? `Loc: ${d.node_address}` : ''}
                        </small>
                    </div>
                </div>
            </div>
        `).join('');
        
        deviceSelect.innerHTML = '<option value="">-- Select Target Devices --</option>' + 
            devices.map(d => `<option value="${d.module_id}" data-type="${d.device_type}" data-network="${d.network}" data-nbm="${d.nbm}">${d.node_name || d.module_id}</option>`).join('');
    }

    // Helper to fetch devices
    async function fetchDevices() {
        if(!deviceList) return;
        deviceList.innerHTML = '<p class="text-gray-500">Fetching devices...</p>';
        
        const message = new Paho.MQTT.Message(JSON.stringify({ command: "$RALL" }));
        message.destinationName = "raspberry/data_request";
        if(isConnected) {
            mqttClient.send(message);
            updateStatus("Requesting Device List...", "blue"); // Fixed function name from showStatus to updateStatus
        } else {
            deviceList.innerHTML = '<p class="text-red-500">Cloud Service Offline</p>';
        }
    }

    // ====== TIME HELPERS ======
    
    function timeToMinutes(timeStr) {
        const [hours, mins] = timeStr.split(':').map(Number);
        return hours * 60 + mins;
    }

    function isOverlapping(startA, endA, startB, endB) {
        return (startA < endB) && (endA > startB);
    }

    // ====== DELETE LOGIC (NEW) ======
    window.deleteSlot = (day, index) => {
        if(confirm("Are you sure you want to delete this session?")) {
            scheduleData.schedule[day].splice(index, 1); // Remove 1 item at specific index
            renderPreview(); // Re-draw list
            updateSendButton(); // Update button state
        }
    };

    // ====== BUILDER LOGIC ======
    
    addSlotBtn.addEventListener('click', () => {
        const day = slotDay.value;
        const startTime = slotStartTime.value;
        const endTime = slotEndTime.value;
        const subject = slotSubject.value;
        const professor = slotProfessor.value;
        const section = slotSection.value;

        slotError.classList.add('hidden');
        slotError.innerText = "";

        if (!day || !startTime || !endTime) return alert("Please select Day and Time (Start & End)");
        if (!subject) return alert("Please enter Subject");

        const startMin = timeToMinutes(startTime);
        const endMin = timeToMinutes(endTime);

        if (startMin >= endMin) {
            slotError.innerText = "Error: End time must be after Start time.";
            slotError.classList.remove('hidden');
            return;
        }

        // --- NEW: DURATION VALIDATION RULE ---
        const duration = endMin - startMin; // Duration in minutes
        
        // Allowed: 60 (1h), 90 (1.5h), 180 (3h)
        if (duration !== 60 && duration !== 90 && duration !== 180) {
            slotError.innerText = `Error: Session duration must be 1h, 1.5h, or 3h. (Current: ${duration} mins)`;
            slotError.classList.remove('hidden');
            return;
        }

        // Conflict Detection
        const existingSlots = scheduleData.schedule[day];
        let hasConflict = false;

        existingSlots.forEach(slot => {
            const sStart = timeToMinutes(slot.start);
            const sEnd = timeToMinutes(slot.end);

            if (isOverlapping(startMin, endMin, sStart, sEnd)) {
                hasConflict = true;
                const conflictText = `Conflict: Classroom occupied from ${slot.start} to ${slot.end}`;
                slotError.innerText = conflictText;
                slotError.classList.remove('hidden');
            }
        });

        if (hasConflict) {
            alert("Cannot add class. Classroom is occupied during this time.");
            return; 
        }

        scheduleData.schedule[day].push({
            start: startTime,
            end: endTime,
            subject: subject || "General",
            professor: professor || "",
            section: section || ""
        });

        scheduleData.schedule[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

        renderPreview();
        updateSendButton();
    });

    resetScheduleBtn.addEventListener('click', () => {
        const days = Object.keys(scheduleData.schedule);
        
        days.forEach(day => {
            scheduleData.schedule[day] = []; 
        });

        renderPreview();
        updateSendButton();
    });
    
    refreshBtn.addEventListener('click', () => {
        fetchDevices();
    });
    function renderPreview() {
        let html = '<div class="space-y-2">';
        
        const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

        allDays.forEach(day => {
            const slots = scheduleData.schedule[day];
            const count = slots.length;
            
            // Header
            html += `
                <div class="flex justify-between items-center mb-1 border-b border-gray-200 pb-1 mt-2">
                    <strong class="text-blue-900">${day}</strong>
                    <span class="text-xs font-bold ${count > 0 ? 'text-blue-600' : 'text-gray-400'}">
                        ${count} Slots
                    </span>
                </div>
            `;

            // List
            if (count > 0) {
                html += `<div class="grid grid-cols-1 gap-1">`;
                slots.forEach((slot, index) => {
                    // Added 'index' to access array position for delete
                    html += `
                        <div class="flex justify-between items-center bg-white p-2 rounded shadow-sm border border-gray-100 text-left group">
                            <div class="flex-grow">
                                <div class="font-bold text-gray-800 text-sm">
                                    <span class="text-blue-600">${slot.start}</span> - <span class="text-red-500">${slot.end}</span> : ${slot.subject}
                                </div>
                                <div class="text-xs text-gray-500 mt-1">${slot.professor} | ${slot.section}</div>
                            </div>
                            <!-- Delete Button -->
                            <button onclick="deleteSlot('${day}', ${index})" 
                                class="ml-2 text-gray-300 hover:text-red-500 transition-colors focus:outline-none p-1" title="Delete Slot">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    `;
                });
                html += `</div>`;
            } else {
                html += `<p class="text-gray-400 text-xs italic py-1">No slots</p>`;
            }
        });

        html += '</div>';
        previewArea.innerHTML = html;
    }

    function updateSendButton() {
        let total = 0;
        const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        
        allDays.forEach(day => {
            total += scheduleData.schedule[day].length;
        });

        if (total > 0) {
            sendScheduleBtn.disabled = false;
            sendScheduleBtn.innerText = `🚀 Send Schedule (${total} Slots)`;
        } else {
            sendScheduleBtn.disabled = true;
            sendScheduleBtn.innerText = "Add Slots First";
        }
    }

    // ====== SEND SCHEDULE ======
    sendScheduleBtn.addEventListener('click', async () => {
        const selectedOptions = Array.from(deviceSelect.selectedOptions);
        
        let total = 0;
        Object.values(scheduleData.schedule).forEach(daySlots => {
            total += daySlots.length;
        });

        if (selectedOptions.length === 0) return alert("Select at least one device");
        if (total === 0) return alert("No schedule data to send");
        if (!isConnected) return alert("MQTT offline");

        try {
            await supabase.from('schedules').upsert({
                classroom_id: scheduleData.classroom,
                validity: scheduleData.validity,
                schedule_data: scheduleData.schedule
            });

            let sendCount = 0;
            
            for (const opt of selectedOptions) {
                const moduleId = opt.value;
                const type = opt.getAttribute('data-type'); 
                
                try {
                    let finalPayload = {};
                    let topic = "raspberry/data_request";

                    if (type === 'pi') {
                        topic = "raspberry/schedule"; 
                        finalPayload = {
                            classroom: scheduleData.classroom,
                            validity: scheduleData.validity,
                            schedule: scheduleData.schedule
                        };
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
                            module_id: moduleId,
                            scheduleData: {
                                days: espDays
                            }
                        };
                    } 

                    const message = new Paho.MQTT.Message(JSON.stringify(finalPayload));
                    message.destinationName = topic;
                    mqttClient.send(message);
                    sendCount++;
                    
                } catch (e) {
                    console.error(e);
                    updateStatus(`Error sending to ${opt.value}`, "error");
                } 
            } 
        
            updateStatus(`Sent to ${sendCount} devices!`, 'success');

        } catch (e) {
            console.error(e);
            updateStatus('Error sending', 'error');
        } 
    });

    // Init
    connectMQTT();
    fetchDevices();

});