document.addEventListener('DOMContentLoaded', () => {
    // ====== CONFIGURATION ======
    const SUPABASE_URL = "https://wmslmgdgxfogaftdweio.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indtc2xtZ2RneGZvZ2FmdGR3ZWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNTcwNzUsImV4cCI6MjA4MTYzMzA3NX0.nsi5Uv8fiw1c1j2pavQvnPeGHZoHHO0GiS6A1fmmt3c";

    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ====== UI ELEMENTS ======
    const refreshBtn = document.getElementById('refreshDevices');
    const deviceList = document.getElementById('deviceList');
    const dropZone = document.getElementById('dropZone');
    const pdfInput = document.getElementById('pdfInput');
    const classroomSelect = document.getElementById('classroomSelect');
    const uploadStatus = document.getElementById('uploadStatus');

    // ====== DEVICE MANAGEMENT ======
    refreshBtn.addEventListener('click', fetchDevices);

    async function fetchDevices() {
        deviceList.innerHTML = '<p class="text-gray-500">Fetching devices...</p>';
        const { data, error } = await supabase.from('devices').select('*');

        if (error) {
            console.error('Error fetching devices:', error);
            deviceList.innerHTML = '<p class="text-red-500">Failed to fetch devices.</p>';
            return;
        }

        deviceList.innerHTML = '';
        if (data.length === 0) {
            deviceList.innerHTML = '<p class="text-gray-500">No devices found. Make sure your ESP and Cloud Service are running.</p>';
        } else {
            data.forEach(device => {
                const deviceEl = document.createElement('div');
                deviceEl.className = 'device-item';
                deviceEl.innerHTML = `
                    <span>
                        <strong>ID:</strong> ${device.module_id} <br>
                        <strong>Network:</strong> ${device.network} <br>
                        <strong>Last Seen:</strong> ${new Date(device.last_seen).toLocaleString()}
                    </span>
                    <span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Online</span>
                `;
                deviceList.appendChild(deviceEl);
            });
        }
    }

    // ====== SCHEDULE UPLOAD ======
    dropZone.addEventListener('click', () => pdfInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) handlePdfFile(files[0]);
    });
    pdfInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handlePdfFile(e.target.files[0]);
    });

    async function handlePdfFile(file) {
        if (file.type !== 'application/pdf') {
            showStatus('Please upload a PDF file.', 'error');
            return;
        }
        if (!classroomSelect.value) {
            showStatus('Please enter a classroom number.', 'error');
            return;
        }

        showStatus('Parsing PDF...', 'loading');
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await window.pdfParse(arrayBuffer);
            const scheduleData = parseScheduleText(pdf.text);
            await uploadSchedule(classroomSelect.value, scheduleData);
            showStatus('Schedule uploaded successfully!', 'success');
        } catch (error) {
            console.error('Error processing PDF:', error);
            showStatus('Failed to parse or upload PDF.', 'error');
        }
    }

    function parseScheduleText(text) {
        // IMPORTANT: This is a simple parser. You MUST adapt it to your PDF format.
        // Example format: "Monday 9:00-10:00: Math"
        const schedule = {};
        const lines = text.split('\n');
        const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

        lines.forEach(line => {
            daysOfWeek.forEach(day => {
                if (line.startsWith(day)) {
                    // This regex looks for "Day Time: Subject"
                    const match = line.match(/(\w+)\s([\d:]+-[\d:]+):\s(.+)/);
                    if (match) {
                        const timeSlot = match[2];
                        const subject = match[3];
                        if (!schedule[day]) schedule[day] = {};
                        schedule[day][timeSlot] = subject;
                    }
                }
            });
        });
        return schedule;
    }

    async function uploadSchedule(classroomId, scheduleData) {
        const { error } = await supabase.from('schedules').upsert({
            classroom_id: classroomId,
            schedule_data: scheduleData
        });
        if (error) throw error;
    }

    function showStatus(message, type) {
        uploadStatus.textContent = message;
        uploadStatus.className = `mt-4 text-sm font-semibold ${
            type === 'success' ? 'text-green-600' :
            type === 'error' ? 'text-red-600' :
            'text-blue-600'
        }`;
    }

    // Initial load
    fetchDevices();

});
