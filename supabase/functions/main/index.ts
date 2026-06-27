import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { connect } from "npm:mqtt@4.3.7";

// --- Configuration ---
// IMPORTANT: Replace these with your actual values from Step 1
const supabaseUrl = Deno.env.get("https://wmslmgdgxfogaftdweio.supabase.co")!; 
const supabaseServiceKey = Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indtc2xtZ2RneGZvZ2FmdGR3ZWlvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjA1NzA3NSwiZXhwIjoyMDgxNjMzMDc1fQ.sqTmkXXdAZS9QCRKrZpas7tvGRkwWjX7VUmvAjDf7YY")!;


// IMPORTANT: Replace these with your MQTT broker details
const mqttBrokerUrl = "8b3f08bad638441bb7bc39536961734b.s1.eu.hivemq.cloud";; 
const mqttUsername = "enitAttendanceSystem";; // Public broker, no username needed
const mqttPassword = "enitAttendanceSystem123"; // Public broker, no password needed


const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --- State Management ---
let mqttClient: any = null;

// --- MQTT Logic ---
// This function connects to the broker to talk to the ESP32s
async function initMqttClient() {
    if (mqttClient) return;
    try {
        mqttClient = await connect({
            host: mqttBrokerUrl,
            port: 8883,
            clientId: `cloud-backend-${Math.random().toString(16).substr(2, 8)}`,
        });
        console.log("MQTT client connected to broker");
    } catch (error) {
        console.error("MQTT connection failed:", error);
    }
}

// --- Main Server Logic (Handles HTTP requests from Raspberry Pi) ---
serve(async (req) => {
    const url = new URL(req.url);
    const path = url.pathname;

    // This is the endpoint the Raspberry Pi will call to send a command
    if (path === '/send-command') {
        try {
            const requestBody = await req.json();
            const { moduleId, command } = requestBody;

            console.log(`Received command from Pi for ESP32 ${moduleId}: ${JSON.stringify(command)}`);

            // Construct the topic for the target ESP32
            const targetTopic = `esp32-in/command`;

            // Publish the command to the correct topic
            if (mqttClient) {
                await mqttClient.publish(targetTopic, JSON.stringify(command));
            }

            return new Response(JSON.stringify({ success: true, message: 'Command sent' }), {
                headers: { "Content-Type": "application/json" },
                status: 200,
            });

        } catch (error) {
            return new Response(JSON.stringify({ success: false, message: 'Invalid request' }), {
                status: 400,
            });
        }
    }

    return new Response("Not Found", { status: 404 });
});

// Initialize the MQTT client when the server starts
initMqttClient();