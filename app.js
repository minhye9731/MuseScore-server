const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// CORS 설정
app.use(cors());
app.use(express.json());

// 업로드 디렉토리 생성
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer 설정 (파일 업로드)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '.mid');
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'audio/midi' || file.originalname.endsWith('.mid') || file.originalname.endsWith('.midi')) {
            cb(null, true);
        } else {
            cb(new Error('MIDI 파일만 업로드 가능합니다.'));
        }
    }
});

// 헬스체크 엔드포인트
app.get('/', (req, res) => {
    res.json({ message: 'MIDI to MusicXML Converter Server', status: 'running' });
});

// MIDI → MusicXML 변환 엔드포인트
app.post('/convert', upload.single('midi'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'MIDI 파일이 필요합니다.' });
    }

    const midiPath = req.file.path;
    const xmlPath = midiPath.replace(/\.(mid|midi)$/, '.musicxml');

    try {
        // MuseScore CLI로 변환 실행
        const command = `mscore -o "${xmlPath}" "${midiPath}"`;
        
        exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('변환 오류:', error);
                // 임시 파일 정리
                cleanupFiles([midiPath, xmlPath]);
                return res.status(500).json({ 
                    error: '변환 중 오류가 발생했습니다.',
                    details: stderr
                });
            }

            // MusicXML 파일 읽기
            fs.readFile(xmlPath, 'utf8', (readError, xmlData) => {
                if (readError) {
                    console.error('파일 읽기 오류:', readError);
                    cleanupFiles([midiPath, xmlPath]);
                    return res.status(500).json({ error: '결과 파일을 읽을 수 없습니다.' });
                }

                // 성공 응답
                res.json({
                    success: true,
                    musicxml: xmlData,
                    originalName: req.file.originalname
                });

                // 임시 파일 정리
                cleanupFiles([midiPath, xmlPath]);
            });
        });

    } catch (err) {
        console.error('서버 오류:', err);
        cleanupFiles([midiPath, xmlPath]);
        res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
    }
});

// 파일 정리 함수
function cleanupFiles(filePaths) {
    filePaths.forEach(filePath => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });
}

// 오래된 임시 파일 정리 (10분마다)
setInterval(() => {
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;

    fs.readdir(uploadsDir, (err, files) => {
        if (err) return;

        files.forEach(file => {
            const filePath = path.join(uploadsDir, file);
            fs.stat(filePath, (statErr, stats) => {
                if (statErr) return;
                
                if (now - stats.mtime.getTime() > tenMinutes) {
                    fs.unlink(filePath, () => {});
                }
            });
        });
    });
}, 10 * 60 * 1000);

app.listen(port, () => {
    console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
});
