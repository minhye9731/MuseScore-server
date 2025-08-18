// app.js - 수정된 버전
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

// MuseScore 명령어 찾기 함수
function findMuseScoreCommand() {
    const possibleCommands = [
        'mscore',
        'musescore',
        'musescore3',
        '/usr/bin/musescore3',
        '/usr/local/bin/musescore3'
    ];
    
    return new Promise((resolve) => {
        let index = 0;
        
        function tryNext() {
            if (index >= possibleCommands.length) {
                resolve(null);
                return;
            }
            
            const cmd = possibleCommands[index];
            exec(`which ${cmd}`, (error) => {
                if (!error) {
                    console.log(`✅ MuseScore 명령어 찾음: ${cmd}`);
                    resolve(cmd);
                } else {
                    index++;
                    tryNext();
                }
            });
        }
        
        tryNext();
    });
}

// 서버 시작 시 MuseScore 명령어 확인
let museScoreCommand = null;

async function initializeServer() {
    console.log('🔍 MuseScore 명령어 검색 중...');
    museScoreCommand = await findMuseScoreCommand();
    
    if (museScoreCommand) {
        console.log(`✅ MuseScore 사용 가능: ${museScoreCommand}`);
        
        // 버전 확인
        exec(`${museScoreCommand} --version`, (error, stdout, stderr) => {
            if (!error) {
                console.log(`📋 MuseScore 버전: ${stdout.trim()}`);
            }
        });
    } else {
        console.error('❌ MuseScore를 찾을 수 없습니다. 수동 설치가 필요합니다.');
    }
}

// 헬스체크 엔드포인트
app.get('/', (req, res) => {
    res.json({ 
        message: 'MIDI to MusicXML Converter Server', 
        status: 'running',
        musescore: museScoreCommand ? 'available' : 'not found'
    });
});

// MIDI → MusicXML 변환 엔드포인트
app.post('/convert', upload.single('midi'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'MIDI 파일이 필요합니다.' });
    }

    if (!museScoreCommand) {
        return res.status(500).json({ error: 'MuseScore가 설치되지 않았습니다.' });
    }

    const midiPath = req.file.path;
    const xmlPath = midiPath.replace(/\.(mid|midi)$/, '.musicxml');

    console.log(`🎵 MIDI 변환 시작: ${path.basename(midiPath)}`);

    try {
        // MuseScore CLI로 변환 실행 (headless 모드)
        const command = `DISPLAY=:99 ${museScoreCommand} -o "${xmlPath}" "${midiPath}"`;
        console.log(`🚀 실행 명령어: ${command}`);
        
        exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
            console.log(`📤 stdout: ${stdout}`);
            console.log(`📤 stderr: ${stderr}`);
            
            if (error) {
                console.error('❌ 변환 오류:', error.message);
                cleanupFiles([midiPath, xmlPath]);
                
                // 더 구체적인 오류 메시지
                let errorMessage = '변환 중 오류가 발생했습니다.';
                if (error.code === 127) {
                    errorMessage = 'MuseScore 실행 파일을 찾을 수 없습니다.';
                } else if (error.killed) {
                    errorMessage = '변환 시간이 초과되었습니다.';
                } else if (stderr.includes('Cannot read')) {
                    errorMessage = 'MIDI 파일을 읽을 수 없습니다.';
                }
                
                return res.status(500).json({ 
                    error: errorMessage,
                    details: {
                        code: error.code,
                        stderr: stderr,
                        command: museScoreCommand
                    }
                });
            }

            // MusicXML 파일 존재 확인
            if (!fs.existsSync(xmlPath)) {
                console.error('❌ MusicXML 파일이 생성되지 않음');
                cleanupFiles([midiPath, xmlPath]);
                return res.status(500).json({ 
                    error: 'MusicXML 파일이 생성되지 않았습니다.',
                    stderr: stderr 
                });
            }

            // MusicXML 파일 읽기
            fs.readFile(xmlPath, 'utf8', (readError, xmlData) => {
                if (readError) {
                    console.error('❌ 파일 읽기 오류:', readError);
                    cleanupFiles([midiPath, xmlPath]);
                    return res.status(500).json({ error: '결과 파일을 읽을 수 없습니다.' });
                }

                console.log(`✅ 변환 성공! XML 크기: ${xmlData.length} characters`);

                // 성공 응답
                res.json({
                    success: true,
                    musicxml: xmlData,
                    originalName: req.file.originalname,
                    size: xmlData.length
                });

                // 임시 파일 정리
                cleanupFiles([midiPath, xmlPath]);
            });
        });

    } catch (err) {
        console.error('❌ 서버 오류:', err);
        cleanupFiles([midiPath, xmlPath]);
        res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
    }
});

// 디버그 엔드포인트 (MuseScore 테스트용)
app.get('/debug', (req, res) => {
    if (!museScoreCommand) {
        return res.json({ error: 'MuseScore not found' });
    }
    
    exec(`${museScoreCommand} --help`, { timeout: 10000 }, (error, stdout, stderr) => {
        res.json({
            command: museScoreCommand,
            error: error ? error.message : null,
            stdout: stdout,
            stderr: stderr
        });
    });
});

// 파일 정리 함수
function cleanupFiles(filePaths) {
    filePaths.forEach(filePath => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️ 임시 파일 삭제: ${path.basename(filePath)}`);
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
                    fs.unlink(filePath, () => {
                        console.log(`🗑️ 오래된 파일 삭제: ${file}`);
                    });
                }
            });
        });
    });
}, 10 * 60 * 1000);

// 서버 초기화 후 시작
initializeServer().then(() => {
    app.listen(port, () => {
        console.log(`🚀 서버가 포트 ${port}에서 실행 중입니다.`);
        console.log(`🎼 MuseScore 상태: ${museScoreCommand || '사용 불가'}`);
    });
});
