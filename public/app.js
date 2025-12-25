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
    let parsedScheduleData = null; 

    // ====== UI ELEMENTS ======
    const deviceSelect = document.getElementById('deviceSelect');
    const sendScheduleBtn = document.getElementById('sendSchedule');
    const uploadStatus = document.getElementById('uploadStatus');
    const parsedScheduleDiv = document.getElementById('parsedSchedule');
    const dropZone = document.getElementById('dropZone');
    const pdfInput = document.getElementById('pdfInput');
    const deviceList = document.getElementById('deviceList');
    const refreshBtn = document.getElementById('refreshDevices');
    const discoverBtn = document.getElementById('discoverDevices');

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
            try {
                const payload = JSON.parse(message.payloadString);
                
                // FIX 1: Handle Discovery Response ($RDNM) - UPDATE UI
                if (payload.respons === "$RDNM") {
                    console.log("Device discovered:", payload.module_id);
                    // Add to UI immediately, then fetch full list
                    addDeviceToUI(payload);
                    setTimeout(fetchDevices, 500); 
                }
                
                // FIX 2: Handle Request All Response ($RALLResp) - UPDATE FULL LIST
                if (payload.command === "$RALLResp") {
                    updateDeviceListUI(payload.devices);
                }
                
                // FIX 3: Handle Parameter Response ($RGOMPara) - UPDATE CARD IN LIST
                if (payload.respons === "$RGOMPara") {
                    updateDeviceInList(payload);
                }
                
            } catch (e) {
                console.error("Error parsing MQTT message:", e);
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
                // SUBSCRIBE TO SEE RESPONSES
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

    // Helper to add single device card
    function addDeviceToUI(device) {
        const item = document.createElement('div');
        item.className = 'bg-white p-4 rounded-lg shadow-md border border-gray-200 mb-2 animate-pulse';
        item.id = `device-${device.module_id}`; // ID for updating later
        item.innerHTML = `
            <div class="flex justify-between items-center">
                <div>
                    <strong>New: ${device.module_id}</strong> <br>
                    <span class="text-gray-500 text-sm">Waiting for details...</span>
                </div>
            </div>
        `;
        // Insert at top of list
        if(deviceList.firstChild) {
            deviceList.insertBefore(item, deviceList.firstChild);
        } else {
            deviceList.appendChild(item);
        }
    }

    // Helper to update a specific device card with details
    function updateDeviceInList(payload) {
        const item = document.getElementById(`device-${payload.module_id}`);
        if (item) {
            const node = payload.node || {};
            const htmlContent = `
                <div class="bg-white p-4 rounded-lg shadow-md border border-gray-200 mb-2">
                    <div class="flex justify-between items-center">
                        <div>
                            <strong class="text-blue-800">${payload.module_id}</strong> <br>
                            <small class="text-gray-500">
                                ${node.node_name ? `Name: ${node.node_name}` : ''} <br>
                                ${node.node_address ? `Loc: ${node.node_address}` : ''}
                            </small>
                        </div>
                        <div class="flex items-center space-x-4">
                            <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">${payload.device_type || 'ESP'}</span>
                            ${payload.last_seen ? `<small class="text-gray-400 text-xs">${new Date(payload.last_seen).toLocaleTimeString()}</small>` : ''}
                        </div>
                    </div>
                </div>
            `;
            // Replace the old "waiting" card with full details
            item.replaceWith(document.createElement('div'));
            item.innerHTML = htmlContent;
        }
    }

    // Helper to update the full list
    function updateDeviceListUI(devices) {
        deviceList.innerHTML = devices.map(d => `
            <div class="bg-white p-4 rounded-lg shadow-md border border-gray-200 mb-2">
                <div class="flex justify-between items-center">
                    <div>
                        <strong class="text-blue-800">${d.module_id}</strong> <br>
                        <small class="text-gray-500">
                            ${d.node_name ? `Name: ${d.node_name}` : ''} <br>
                            ${d.node_address ? `Loc: ${d.node_address}` : ''}
                        </small>
                    </div>
                    <div class="flex items-center space-x-4">
                        <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">${d.device_type || 'ESP'}</span>
                        ${d.last_seen ? `<small class="text-gray-400 text-xs">${new Date(d.last_seen).toLocaleTimeString()}</small>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
        
        // Update Dropdown
        deviceSelect.innerHTML = '<option value="" disabled>-- Select Target Devices --</option>' + 
            devices.map(d => `<option value="${d.module_id}" data-type="${d.device_type}" data-network="${d.network}" data-nbm="${d.nbm}">${d.node_name || d.module_id}</option>`).join('');
    }

    // Call fetchDevices (now sends $RALL command instead of direct DB call)
    async function fetchDevices() {
        if(!deviceList) return;
        deviceList.innerHTML = '<p class="text-gray-500">Requesting device list...</p>';
        
        const message = new Paho.MQTT.Message(JSON.stringify({ command: "$RALL" }));
        message.destinationName = "raspberry/data_request";
        mqttClient.send(message);
    }

    // ====== PDF PARSING ======
    // ... (Keep your existing PDF parsing code) ...
    dropZone.addEventListener('click', () => pdfInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handlePdfFile(e.dataTransfer.files[0]);
    });
    pdfInput.addEventListener('change', (e) => handlePdfFile(e.target.files[0]));

    async function handlePdfFile(file) {
        if (file.type !== 'application/pdf') return showStatus('Upload PDF only', 'error');
        
        showStatus('Parsing...', 'loading');
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await window.pdfParse(arrayBuffer);
            const parsed = parseScheduleText(pdf.text);
            
            if (!parsed.classroom) throw new Error("Classroom number not found.");
            parsedScheduleData = parsed;
            
            displayParsedSchedule(parsed);
            showStatus('Parsed. Select device & Send.', 'success');
        } catch (err) {
            console.error("Parse Error:", err);
            showStatus('Parse Error: ' + err.message, 'error');
        }
    }

    function parseScheduleText(text) {
        const result = {
            classroom: null,
            validity: { from: null, to: null },
            schedule: {} 
        };

        const lines = text.split('\n');
        const days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche", 
                      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

        lines.forEach(line => {
            // 1. Classroom
            const roomMatch = line.match(/(?:Salle|Room|Classroom|Numero)\s*[:]\s*(\d+)/i);
            if (roomMatch) result.classroom = roomMatch[1];

            // 2. Validity
            const validMatch = line.match(/(?:Du|From|Valid)\s*[:]\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s*(?:au|to|-)\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
            if (validMatch) {
                result.validity.from = validMatch[1].replace(/\//g, '-');
                result.validity.to = validMatch[2].replace(/\//g, '-');
            }

            // 3. Schedule
            days.forEach(day => {
                if (line.includes(day)) {
                    if (!result.schedule[day]) result.schedule[day] = [];
                    
                    const timeRegex = /(\d{2}:\d{2})-(\d{2}:\d{2})/;
                    const match = line.match(timeRegex);

                    if (match) {
                        let infoText = line.replace(day, '').replace(match[0], '').trim();
                        const parts = infoText.split(/\s{2,}|\t/); 
                        
                        result.schedule[day].push({
                            start: match[1],
                            end: match[2],
                            subject: parts[0] || "Unknown",
                            teacher: parts[1] || "",
                            section: parts[2] || ""
                        });
                    }
                }
            });
        });
        return result;
    }

    function displayParsedSchedule(data) {
        parsedScheduleDiv.innerHTML = `
            <div class="bg-blue-50 p-3 rounded border border-blue-200 mb-2">
                <strong>Class:</strong> ${data.classroom} | 
                <strong>Valid:</strong> ${data.validity.from} to ${data.validity.to}
            </div>
            <pre class="text-xs bg-gray-100 p-2 rounded overflow-auto max-h-32">${JSON.stringify(data.schedule, null, 2)}</pre>
        `;
        sendScheduleBtn.disabled = false;
    }

    function showStatus(msg, type) {
        uploadStatus.textContent = msg;
        uploadStatus.className = `mt-2 text-sm font-semibold ${type === 'success' ? 'text-green-600' : type === 'error' ? 'text-red-600' : 'text-blue-600'}`;
    }

    // ====== BUTTON ACTIONS ======
    discoverBtn.addEventListener('click', () => {
        if(!isConnected) return alert("MQTT not connected");
        const message = new Paho.MQTT.Message(JSON.stringify({ command: "$DNM" }));
        message.destinationName = "raspberry/data_request";
        mqttClient.send(message);
        showStatus("Broadcasting Discovery...", "blue");
    });

    refreshBtn.addEventListener('click', fetchDevices);

    // ====== SEND SCHEDULE (MULTI-SELECT) ======
    sendScheduleBtn.addEventListener('click', async () => {
        const selectedOptions = Array.from(deviceSelect.selectedOptions);
        
        if (selectedOptions.length === 0) return alert("Select at least one device");
        if (!parsedScheduleData) return alert("No data");
        if (!isConnected) return alert("MQTT offline");

        try {
            // Save to Supabase
            await supabase.from('schedules').upsert({
                classroom_id: parsedScheduleData.classroom,
                validity: parsedScheduleData.validity,
                schedule_data: parsedScheduleData.schedule
            });

            let sendCount = 0;
            
            // Loop through all selected devices
            for (const opt of selectedOptions) {
                const moduleId = opt.value;
                const type = opt.getAttribute('data-type'); 
                
                try {
                    let finalPayload = {};
                    let topic = "raspberry/data_request";

                    // --- CASE 1: RASPBERRY FORMAT ---
                    if (type === 'pi') {
                        topic = "raspberry/schedule"; 
                        finalPayload = {
                            classroom: parsedScheduleData.classroom,
                            validity: parsedScheduleData.validity,
                            schedule: parsedScheduleData.schedule
                        };
                    } 
                    // --- CASE 2: ESP FORMAT ---
                    else {
                        const espDays = {};
                        Object.keys(parsedScheduleData.schedule).forEach(day => {
                            espDays[day] = { events: {} };
                            parsedScheduleData.schedule[day].forEach((slot, index) => {
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
                }
            }
            
            showStatus(`Sent to ${sendCount} devices!`, 'success');

        } catch (e) {
            console.error(e);
            showStatus('Error sending', 'error');
        }
    });

    // Init
    connectMQTT();
    fetchDevices(); // Load devices initially
});