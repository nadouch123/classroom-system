// This is a simplified working version
const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

console.log('🚀 Starting Classroom Server...');

// Supabase setup
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// MQTT setup
const mqttClient = mqtt.connect({
    host: process.env.MQTT_HOST,
    port: parseInt(process.env.MQTT_PORT),
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    protocol: 'mqtts'
});

// Store data in memory
let sensorData = {};
let presenceList = [];
let connectedDevices = [];

mqttClient.on('connect', () => {
    console.log('✅ Connected to MQTT Broker');
    
    // Subscribe to all topics
    mqttClient.subscribe('#', (err) => {
        if (!err) {
            console.log('✅ Subscribed to all topics');
        }
    });
});

mqttClient.on('message', async (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        console.log(`📨 Message received on ${topic}:`, payload);
        
        // Handle ESP32 sensor data
        if (topic.includes('esp32-in/response')) {
            sensorData = {
                ...sensorData,
                ...payload,
                lastUpdate: new Date().toISOString()
            };
            
            // Store in Supabase
            await supabase.from('sensor_readings').insert({
                module_id: payload.module_id || '111',
                temperature: payload.temperature,
                energy: payload.energy,
                data: payload,
                timestamp: new Date()
            });
            
            // Forward to Raspberry Pi
            mqttClient.publish('raspberry/data_response', JSON.stringify({
                type: 'sensor_update',
                data: sensorData
            }));
        }
        
        // Handle Raspberry Pi enrollment
        if (payload.type === 'enrollment') {
            const { data, error } = await supabase
                .from('users')
                .insert({
                    name: payload.name,
                    surname: payload.surname,
                    role: payload.role,
                    section: payload.section,
                    face_features: payload.face_features,
                    created_at: new Date()
                });
            
            mqttClient.publish('raspberry/data_response', JSON.stringify({
                type: 'enrollment_response',
                status: error ? 'error' : 'success',
                message: error ? 'Failed to enroll' : `Welcome ${payload.name}!`
            }));
        }
        
        // Handle presence request
        if (payload.type === 'presence_request') {
            const { data } = await supabase
                .from('presence')
                .select('*')
                .eq('date', new Date().toISOString().split('T')[0])
                .eq('classroom_id', payload.classroom_id);
            
            mqttClient.publish('raspberry/data_response', JSON.stringify({
                type: 'presence_list',
                data: data || []
            }));
        }
        
    } catch (err) {
        console.error('Error processing message:', err);
    }
});

// API Endpoints
app.get('/api/status', (req, res) => {
    res.json({
        server: 'online',
        mqtt: mqttClient.connected ? 'connected' : 'disconnected',
        lastSensorUpdate: sensorData.lastUpdate || 'never',
        devices: connectedDevices
    });
});

app.get('/api/sensor-data', (req, res) => {
    res.json(sensorData);
});

app.get('/api/presence', async (req, res) => {
    const { data } = await supabase
        .from('presence')
        .select('*')
        .eq('date', new Date().toISOString().split('T')[0])
        .order('timestamp', { ascending: true });
    
    res.json(data || []);
});

// Start server
app.listen(process.env.SERVER_PORT, () => {
    console.log(`✅ Server running on http://localhost:${process.env.SERVER_PORT}`);
    console.log('📡 Waiting for devices to connect...');
});