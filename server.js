const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8 // Límite de subida de archivos (100MB)
});

// Configurar directorio de almacenamiento para archivos, fotos y audios
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

app.use(express.static('public'));
app.use(express.json());

// Endpoint para subir archivos adjuntos y notas de voz
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, name: req.file.originalname, type: req.file.mimetype });
});

// Mapeo global de usuarios conectados: NumeroDeTelefono -> SocketID
const connectedUsers = new Map();

io.on('connection', (socket) => {
    let userPhone = null;

    // Registro del número de teléfono al iniciar sesión
    socket.on('register_user', (phone) => {
        userPhone = phone.trim();
        connectedUsers.set(userPhone, socket.id);
        console.log(`[CONECTADO] Usuario con número: ${userPhone} (Socket ID: ${socket.id})`);
        
        socket.emit('registration_success', { phone: userPhone });
        // Emitir lista global de usuarios en línea
        io.emit('online_users', Array.from(connectedUsers.keys()));
    });

    // Envío directo de mensajes por número de teléfono objetivo
    socket.on('send_private_message', (data) => {
        const { targetPhone, message, type, fileUrl, fileName } = data;
        const targetSocketId = connectedUsers.get(targetPhone.trim());

        const payload = {
            fromPhone: userPhone,
            toPhone: targetPhone,
            message: message || '',
            type: type || 'text', // 'text', 'image', 'audio', 'file'
            fileUrl: fileUrl || null,
            fileName: fileName || null,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        // Si el destinatario está conectado, se le entrega en tiempo real
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive_private_message', payload);
        }

        // Confirmación para el emisor
        socket.emit('message_delivered', payload);
    });

    // Indicador de "Escribiendo..."
    socket.on('typing', ({ targetPhone, isTyping }) => {
        const targetSocketId = connectedUsers.get(targetPhone.trim());
        if (targetSocketId) {
            io.to(targetSocketId).emit('user_typing', { fromPhone: userPhone, isTyping });
        }
    });

    // Manejar desconexión
    socket.on('disconnect', () => {
        if (userPhone) {
            connectedUsers.delete(userPhone);
            console.log(`[DESCONECTADO] Usuario: ${userPhone}`);
            io.emit('online_users', Array.from(connectedUsers.keys()));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`Servidor de WhatsApp ejecutándose en http://localhost:${PORT}`);
    console.log(`====================================================`);
});