// public/app.js
// --- Configuration ---
// IMPORTANT: Replace with your actual values from Step 1
const SUPABASE_URL = "https://wmslmgdgxfogaftdweio.supabase.co"; 
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indtc2xtZ2RneGZvZ2FmdGR3ZWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNTcwNzUsImV4cCI6MjA4MTYzMzA3NX0.nsi5Uv8fiw1c1j2pavQvnPeGHZoHHO0GiS6A1fmmt3c";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- DOM Elements ---
const pdfFileInput = document.getElementById('pdfFile');
const uploadBtn = document.getElementById('uploadBtn');
const uploadStatus = document.getElementById('uploadStatus');
const scheduleContainer = document.getElementById('scheduleContainer');
const sendToDeviceBtn = document.getElementById('sendToDeviceBtn');
const esp32List = document.getElementById('esp32List');

let currentSchedule = null;

// --- Event Listeners ---
window.addEventListener('DOMContentLoaded', () => {
    loadCurrentSchedule();
    loadConnectedDevices();
});

uploadBtn.addEventListener('click', uploadAndParsePdf);
sendToDeviceBtn.addEventListener('click', sendScheduleToDevices);

// --- Functions ---

// Load and display the current schedule from the database
async function loadCurrentSchedule() {
    const { data, error } = await supabase
        .from('schedules')
        .select('schedule_data')
        .eq('id', 'current')
        .single();

    if (error) {
        console.error('Error loading schedule:', error);
        scheduleContainer.innerHTML = '<p class="error">Error loading schedule.</p>';
        return;
    }

    if (data) {
        currentSchedule = data.schedule_data;
        displaySchedule(currentSchedule);
    } else {
        scheduleContainer.innerHTML = '<p>No schedule found.</p>';
    }
}

// Display the schedule in a simple table
function displaySchedule(schedule) {
    if (!schedule || !schedule.days) {
        scheduleContainer.innerHTML = '<p>No schedule data available.</p>';
        return;
    }
    
    let tableHTML = '<table class="schedule-table"><tr><th>Day</th><th>Start Time</th><th>End Time</th></tr>';
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    
    days.forEach(day => {
        if (schedule.days[day] && schedule.days[day].events) {
            Object.values(schedule.days[day].events).forEach(event => {
                tableHTML += `<tr><td>${day}</td><td>${event.startdate}</td><td>${event.enddate}</td></tr>`;
            });
        }
    });
    
    tableHTML += '</table>';
    scheduleContainer.innerHTML = tableHTML;
}

// Handle PDF upload (this is a simplified parser)
async function uploadAndParsePdf() {
    const file = pdfFileInput.files[0];
    if (!file) {
        showStatus('Please select a PDF file.', 'error');
        return;
    }

    showStatus('Uploading and parsing...', 'info');

    // For this example, we'll use a hardcoded schedule.
    // In a real project, you would use a PDF parsing library.
    const parsedSchedule = {
        days: {
            "Monday": { events: { "1": { startdate: "09:00:00", enddate: "12:00:00" } } },
            "Tuesday": { events: { "1": { startdate: "09:00:00", enddate: "12:00:00" } } },
        }
    };

    currentSchedule = parsedSchedule;
    displaySchedule(currentSchedule);
    showStatus('Schedule parsed successfully! Click "Send" to store it.', 'success');
}

// Send the current schedule to the database
async function sendScheduleToDevices() {
    if (!currentSchedule) {
        showStatus('No schedule to send. Please upload one first.', 'error');
        return;
    }

    showStatus('Saving schedule...', 'info');

    // Save the new schedule to the database
    const { error: dbError } = await supabase
        .from('schedules')
        .upsert({ id: 'current', schedule_data: currentSchedule });

    if (dbError) {
        console.error('Error saving schedule:', dbError);
        showStatus('Error saving schedule to database.', 'error');
        return;
    }

    showStatus('Schedule saved! Devices will receive it on their next connection or refresh.', 'success');
}

// Load and display a list of connected ESP32s
async function loadConnectedDevices() {
    const { data: devices, error } = await supabase
        .from('devices')
        .select('*')
        .eq('type', 'esp32');

    if (error) {
        console.error('Error loading devices:', error);
        esp32List.innerHTML = '<p class="error">Error loading devices.</p>';
        return;
    }

    if (devices.length === 0) {
        esp32List.innerHTML = '<p>No ESP32 devices found.</p>';
        return;
    }

    let listHTML = '';
    devices.forEach(device => {
        const isOnline = device.status === 'online';
        listHTML += `
            <div class="device-item">
                <h4>Module ID: ${device.id}</h4>
                <p>Network: ${device.network || 'N/A'} | NBM: ${device.nbm || 'N/A'}</p>
                <p class="status ${isOnline ? 'online' : 'offline'}">Status: ${device.status}</p>
            </div>
        `;
    });
    esp32List.innerHTML = listHTML;
}

// Helper to show status messages
function showStatus(message, type) {
    uploadStatus.textContent = message;
    uploadStatus.className = `status-message ${type}`;
}