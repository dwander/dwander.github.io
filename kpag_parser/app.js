// =============================================================================
// KPAG 카카오톡 스케줄 파서
// =============================================================================

// 전역 변수
let parsedData = [];
let currentFile = null;

// DOM 요소들
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const textInput = document.getElementById('textInput');
const charCount = document.getElementById('charCount');
const speakerName = document.getElementById('speakerName');
const autoDetect = document.getElementById('autoDetect');
const parseBtn = document.getElementById('parseBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resultsBody = document.getElementById('resultsBody');
const modalResultsBody = document.getElementById('modalResultsBody');
const totalCount = document.getElementById('totalCount');
const loadingDiv = document.getElementById('loadingDiv');
const errorDiv = document.getElementById('errorDiv');
const successDiv = document.getElementById('successDiv');
const expandBtn = document.getElementById('expandBtn');
const fullscreenModal = document.getElementById('fullscreenModal');
const closeModal = document.getElementById('closeModal');
const tableHeader = document.getElementById('tableHeader');
const modalTableHeader = document.getElementById('modalTableHeader');

// =============================================================================
// 핵심 파싱 함수들
// =============================================================================

// 신랑신부 이름 분리 함수
function splitTwoNames(s) {
    const m = s.match(/^\s*(?:(\S+)\s+(\S+\s+\S+)|(\S+\s+\S+)\s+(\S+)|(\S+)\s+(\S+)|(\S+\s+\S+)\s+(\S+\s+\S+))\s*$/);
    return m ? [m[1]||m[3]||m[5]||m[7], m[2]||m[4]||m[6]||m[8]] : null;
}

// 스케줄 라인 유효성 검증
function isValidScheduleLine(line) {
    const trimmedLine = line.trim();
    
    if (trimmedLine.length <= 1) return false;
    if (trimmedLine.includes('---------------')) return false;
    if (/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/.test(trimmedLine)) return false;
    if (/^(월|화|수|목|금|토|일)요일\s*$/.test(trimmedLine)) return false;
    
    // 순수 이모티콘/인사말만 있는 라인 제외
    const pureExcludePatterns = [
        /^건입니\s*$/, /^확인\s*$/, /^감사\s*$/, /^스케줄입니다\s*$/, /^부탁드리겠습니\s*$/,
        /^[\^\s]*$/, /^[:)\s]*$/, /^[:D\s]*$/, /^[ㅠㅜ\s]*$/, /^헉\s*$/, /^아하\s*$/,
        /^안녕하세요\s*$/, /^좋은아침\s*$/, /^잘다녀오\s*$/, /^기상체크\s*$/, /^확인부탁\s*$/,
        /^재발송\s*$/, /^특이사항\s*$/, /^전체\s*재확인\s*$/, /^내용\s*한번씩\s*$/, /^이번주\s*$/
    ];
    
    for (const pattern of pureExcludePatterns) {
        if (pattern.test(trimmedLine)) return false;
    }
    
    return true;
}

// 필수 필드 검증
function isValidScheduleBlock(lines) {
    if (lines.length < 4) return false;
    
    // 1. 날짜 검증
    const dateLine = lines[0].trim();
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateLine)) return false;
    
    // 2. 시간 검증
    let hasValidTime = false;
    for (let i = 1; i < Math.min(lines.length, 4); i++) {
        const line = lines[i].trim();
        if (/^\d{1,2}:\d{2}$/.test(line)) {
            hasValidTime = true;
            break;
        }
    }
    if (!hasValidTime) return false;
    
    // 3. 웨딩홀 검증
    if (!lines[1] || lines[1].trim().length < 2) return false;
    
    // 4. 신랑신부 검증
    const hasCoupleNames = lines.some((line, index) => {
        const trimmedLine = line.trim();
        const result = splitTwoNames(trimmedLine);
        
        if (result !== null && result[0] && result[1]) {
            const isKoreanNames = /^[가-힣\s]+$/.test(trimmedLine);
            const isNotVenue = index !== 1;
            const isNotPhone = !/010[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(trimmedLine);
            const isNotBrand = !/[KBA]\s*\[|세컨플로우|세븐스|그라피|\d+[pP]/.test(trimmedLine);
            
            return isKoreanNames && isNotVenue && isNotPhone && isNotBrand;
        }
        return false;
    });
    if (!hasCoupleNames) return false;
    
    // 5. 브랜드/상품 검증
    const hasBrand = lines.some(line => 
        /[KBA]\s*\[/.test(line) || 
        /(세븐스|그라피|플로우)/i.test(line) ||
        /\d+[pP]/.test(line)
    );
    if (!hasBrand) return false;
    
    const hasProduct = lines.some(line => /\d+[pP]/.test(line));
    if (!hasProduct) return false;
    
    return true;
}

// 브랜드/상품 파싱
function parseBrandProduct(text) {
    let cleaned = text
        .replace(/\([^)]*\)/g, '')
        .replace(/\d+권/g, '')
        .replace(/미니북.*$/g, '')
        .replace(/\+.*$/g, '')
        .trim();
    
    const patterns = [
        /(기본\s*\d+[pP])$/i,
        /(\d+[pP])$/i,
        /(기본)$/,
        /(프리미엄)$/,
        /(스탠다드)$/
    ];
    
    let product = '기본';
    let brand = cleaned;
    
    for (const pattern of patterns) {
        const match = cleaned.match(pattern);
        if (match) {
            product = match[1].replace(/\s+/g, ' ');
            brand = cleaned.replace(pattern, '').trim();
            break;
        }
    }
    
    return { 
        brand: brand.replace(/\[|\]/g, ''), 
        product 
    };
}

// 완전한 스케줄 파싱
function parseCompleteSchedule(lines) {
    const schedule = {};
    let idx = 0;
    
    schedule.날짜 = lines[idx++] || '';
    schedule.예식장홀 = lines[idx++] || '';
    schedule.시간 = lines[idx++] || '';
    schedule.신랑신부 = lines[idx++] || '';
    
    // 연락처 체크
    if (idx < lines.length && /010[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(lines[idx])) {
        schedule.연락처 = lines[idx++];
    } else {
        schedule.연락처 = '';
    }
    
    // 브랜드상품
    if (idx < lines.length) {
        const brandProduct = parseBrandProduct(lines[idx++]);
        schedule.브랜드 = brandProduct.brand;
        schedule.상품 = brandProduct.product;
    } else {
        schedule.브랜드 = '';
        schedule.상품 = '';
    }
    
    // 나머지 파싱 (작가 및 요청사항)
    const remaining = lines.slice(idx);
    
    // 작가 라인들 찾기
    const photographerIndices = [];
    remaining.forEach((line, index) => {
        const trimmed = line.trim();
        const isKoreanName = /^[가-힣]{2,3}$/.test(trimmed);
        const isPhotographerWithPhone = /^[가-힣]{2,4}\s+010[-.\s]?\d{3,4}[-.\s]?\d{4}.*(?:메인|서브)/.test(trimmed);
        const hasPhoneWithRole = /010[-.\s]?\d{3,4}[-.\s]?\d{4}.*(?:메인|서브)/.test(trimmed);
        
        if (isKoreanName || isPhotographerWithPhone || hasPhoneWithRole) {
            photographerIndices.push(index);
        }
    });
    
    // 요청사항: 작가 라인들과 마지막 라인 제외
    let requirements = [];
    for (let i = 0; i < remaining.length - 1; i++) {
        if (!photographerIndices.includes(i)) {
            requirements.push(remaining[i]);
        }
    }
    
    // 업체/플래너 (마지막 라인)
    const lastLine = remaining[remaining.length - 1] || '';
    let company = '';
    let planner = '';
    
    if (lastLine.includes(' ')) {
        const parts = lastLine.split(' ');
        company = parts[0];
        planner = parts.slice(1).join(' ');
    } else {
        company = lastLine;
    }
    
    schedule.요청사항 = requirements.join(' ');
    schedule.업체 = company;
    schedule.플래너 = planner;
    
    // 신랑신부 분리
    const nameResult = splitTwoNames(schedule.신랑신부);
    if (nameResult && nameResult[0] && nameResult[1]) {
        schedule.신랑 = nameResult[0];
        schedule.신부 = nameResult[1];
    } else {
        schedule.신랑 = '';
        schedule.신부 = '';
    }
    
    return schedule;
}

// =============================================================================
// 메시지 처리 함수들
// =============================================================================

// 화자 메시지 추출
function extractSpeakerMessages(chatText) {
    const lines = chatText.split('\n');
    const speakers = new Set();
    const messages = {};
    
    let currentSpeaker = null;
    let currentMessage = [];
    let currentTime = null;
    
    for (let line of lines) {
        const speakerPattern = /^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/;
        const match = line.match(speakerPattern);
        
        if (match) {
            if (currentSpeaker && currentMessage.length > 0) {
                if (!messages[currentSpeaker]) messages[currentSpeaker] = [];
                messages[currentSpeaker].push({
                    content: currentMessage.join('\n'),
                    time: currentTime,
                    lines: [...currentMessage]
                });
            }
            
            const [, speaker, time, content] = match;
            speakers.add(speaker);
            currentSpeaker = speaker;
            currentTime = time;
            currentMessage = content.trim() ? [content] : [];
        } else if (line.trim() && currentSpeaker) {
            currentMessage.push(line);
        }
    }
    
    if (currentSpeaker && currentMessage.length > 0) {
        if (!messages[currentSpeaker]) messages[currentSpeaker] = [];
        messages[currentSpeaker].push({
            content: currentMessage.join('\n'),
            time: currentTime,
            lines: [...currentMessage]
        });
    }
    
    return { speakers: Array.from(speakers), messages };
}

// 메시지별 스케줄 블록 추출 (유연한 날짜 인식)
function extractScheduleBlocksFromMessage(messageContent, messageIndex) {
    const lines = messageContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const blocks = [];
    
    for (let i = 0; i < lines.length; i++) {
        // 날짜 패턴을 더 유연하게: 앞뒤 문자 허용하되 날짜 부분만 추출
        const dateMatch = lines[i].match(/(\d{4}\.\d{2}\.\d{2})/);
        if (dateMatch) {
            const dateOnly = dateMatch[1]; // 순수 날짜만 추출
            const block = [dateOnly]; // 정리된 날짜로 시작
            let j = i + 1;
            
            while (j < lines.length) {
                const nextDateMatch = lines[j].match(/(\d{4}\.\d{2}\.\d{2})/);
                if (nextDateMatch) break; // 다음 날짜를 만나면 중단
                
                if (isValidScheduleLine(lines[j])) {
                    block.push(lines[j]);
                }
                j++;
            }
            
            if (block.length >= 4) {
                blocks.push({ 
                    lines: block, 
                    messageIndex: messageIndex,
                    startIndex: i 
                });
            }
            i = j - 1;
        }
    }
    
    return blocks;
}

// 변경사항 감지
function detectChanges(blocks) {
    const changes = [];
    const finalSchedules = [];
    
    const byUniqueSchedule = {};
    blocks.forEach(block => {
        const date = block.lines[0];
        const venue = block.lines[1] || '';
        
        let coupleNames = '';
        for (let i = 0; i < block.lines.length; i++) {
            const line = block.lines[i];
            const trimmedLine = line.trim();
            const result = splitTwoNames(trimmedLine);
            
            if (result !== null && result[0] && result[1]) {
                const isKoreanNames = /^[가-힣\s]+$/.test(trimmedLine);
                const isNotVenue = i !== 1;
                const isNotPhone = !/010[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(trimmedLine);
                const isNotBrand = !/[KBA]\s*\[|세컨플로우|세븐스|그라피|\d+[pP]/.test(trimmedLine);
                
                if (isKoreanNames && isNotVenue && isNotPhone && isNotBrand) {
                    coupleNames = trimmedLine;
                    break;
                }
            }
        }
        
        const key = `${date}|${venue.trim()}|${coupleNames}`;
        
        if (!byUniqueSchedule[key]) byUniqueSchedule[key] = [];
        byUniqueSchedule[key].push(block);
    });
    
    Object.entries(byUniqueSchedule).forEach(([key, scheduleBlocks]) => {
        const [date, venue, coupleNames] = key.split('|');
        
        if (scheduleBlocks.length > 1) {
            changes.push({
                type: 'CHANGE',
                date,
                venue,
                coupleNames,
                count: scheduleBlocks.length,
                blocks: scheduleBlocks
            });
            const latestBlock = scheduleBlocks.reduce((latest, current) => 
                current.messageIndex > latest.messageIndex ? current : latest
            );
            finalSchedules.push(latestBlock);
        } else {
            finalSchedules.push(scheduleBlocks[0]);
        }
    });
    
    return { changes, finalSchedules };
}

// 메인 파싱 함수
async function parseKakaoChat(chatText, targetSpeaker) {
    const speakers = extractSpeakerMessages(chatText);
    
    if (speakers.speakers.length === 0) {
        throw new Error('카카오톡 대화 형식을 인식할 수 없습니다.');
    }

    let finalSpeaker = targetSpeaker;
    
    if (autoDetect.checked || !targetSpeaker) {
        let bestSpeaker = '';
        let maxSchedules = 0;
        
        for (const speaker of speakers.speakers) {
            const speakerText = speakers.messages[speaker]
                .map(msg => msg.content).join('\n');
            const scheduleCount = (speakerText.match(/\d{4}\.\d{2}\.\d{2}/g) || []).length;
            
            if (scheduleCount > maxSchedules) {
                maxSchedules = scheduleCount;
                bestSpeaker = speaker;
            }
        }
        
        if (bestSpeaker) {
            finalSpeaker = bestSpeaker;
        }
    }
    
    if (!speakers.messages[finalSpeaker]) {
        throw new Error(`"${finalSpeaker}" 화자를 찾을 수 없습니다. 사용 가능한 화자: ${speakers.speakers.join(', ')}`);
    }

    const managerMessages = speakers.messages[finalSpeaker];
    const allScheduleBlocks = [];
    
    managerMessages.forEach((message, messageIndex) => {
        const messageBlocks = extractScheduleBlocksFromMessage(message.content, messageIndex);
        allScheduleBlocks.push(...messageBlocks);
    });
    
    const validBlocks = allScheduleBlocks.filter(block => 
        isValidScheduleBlock(block.lines)
    );
    
    const changeAnalysis = detectChanges(validBlocks);
    
    const finalSchedules = changeAnalysis.finalSchedules.map(block => 
        parseCompleteSchedule(block.lines)
    );

    return {
        success: true,
        statistics: {
            totalSpeakers: speakers.speakers.length,
            targetSpeaker: finalSpeaker,
            scheduleBlocks: allScheduleBlocks.length,
            changes: changeAnalysis.changes.length,
            finalSchedules: finalSchedules.length
        },
        speakers: speakers.speakers,
        changes: changeAnalysis.changes,
        schedules: finalSchedules
    };
}

// =============================================================================
// UI 함수들
// =============================================================================

// 테이블 행 생성
function createTableRow(schedule) {
    const row = document.createElement('tr');
    const fields = ['날짜', '시간', '예식장홀', '신랑', '신부', '연락처', '브랜드', '상품', '업체', '플래너', '요청사항'];
    
    fields.forEach((field, index) => {
        const td = document.createElement('td');
        let value = schedule[field] || '';
        
        if (field === '요청사항' && value.length > 50) {
            td.title = value;
            value = value.substring(0, 47) + '...';
        }
        
        td.textContent = value;
        row.appendChild(td);
    });
    
    return row;
}

// 결과 업데이트
function updateResults(result) {
    updateTableHeaders();
    
    const tbody = resultsBody;
    const modalTbody = modalResultsBody;
    
    // 가이드 제거하고 결과 표시
    tbody.innerHTML = '';
    modalTbody.innerHTML = '';
    
    if (result.schedules.length === 0) {
        const emptyRow = `
            <tr>
                <td colspan="11" style="text-align: center; padding: 48px; color: #64748b;">
                    파싱된 스케줄이 없습니다
                </td>
            </tr>
        `;
        tbody.innerHTML = emptyRow;
        modalTbody.innerHTML = emptyRow;
        return;
    }
    
    result.schedules.forEach(schedule => {
        const mainRow = createTableRow(schedule);
        const modalRow = createTableRow(schedule);
        tbody.appendChild(mainRow);
        modalTbody.appendChild(modalRow);
    });
    
    totalCount.textContent = result.schedules.length;
}

function updateTableHeaders() {
    const headers = ['날짜', '시간', '예식장', '신랑', '신부', '연락처', '브랜드', '상품', '업체', '플래너', '요청사항'];
    const headerRow = headers.map(header => `<th>${header}</th>`).join('');
    tableHeader.innerHTML = headerRow;
    modalTableHeader.innerHTML = headerRow;
}

// 메시지 시스템 (원래 방식)
function showError(message) {
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => errorDiv.style.display = 'none', 5000);
}

function showSuccess(message) {
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    setTimeout(() => successDiv.style.display = 'none', 3000);
}

function hideMessages() {
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
}

function setLoading(loading) {
    if (loading) {
        loadingDiv.style.display = 'block';
        parseBtn.disabled = true;
        downloadBtn.disabled = true;
    } else {
        loadingDiv.style.display = 'none';
        parseBtn.disabled = false;
    }
}

// =============================================================================
// 이벤트 처리
// =============================================================================

// 파일 처리
function handleFile(file) {
    if (!file.name.endsWith('.txt')) {
        showError('txt 파일만 업로드 가능합니다.');
        return;
    }

    currentFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        textInput.value = e.target.result;
        updateCharCount();
        
        dropZone.classList.add('has-file');
        dropZone.innerHTML = `
            <div class="drop-zone-icon">✅</div>
            <div class="drop-zone-text">파일이 로드되었습니다</div>
        `;
        
        fileInfo.innerHTML = `파일: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`;
        fileInfo.classList.remove('hidden');
        
        // 파일 input value 초기화
        fileInput.value = '';
        
        // 자동 파싱
        setTimeout(() => {
            handleParse();
        }, 300);
    };
    reader.readAsText(file, 'utf-8');
}

// 파싱 실행
async function handleParse() {
    const text = textInput.value.trim();
    if (!text) {
        showError('파싱할 텍스트를 입력하세요.');
        return;
    }

    setLoading(true);
    hideMessages();

    try {
        const result = await parseKakaoChat(text, speakerName.value.trim());
        
        if (!result.success) {
            throw new Error(result.error);
        }

        parsedData = result.schedules;
        updateResults(result);
        downloadBtn.disabled = false;
        
        showSuccess(`파싱 완료! ${parsedData.length}개의 스케줄을 찾았습니다.`);
        
    } catch (error) {
        console.error('파싱 오류:', error);
        showError(`파싱 중 오류가 발생했습니다: ${error.message}`);
    } finally {
        setLoading(false);
    }
}

// 파일 이벤트
function handleDragOver(e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        handleFile(file);
    }
}

function updateCharCount() {
    const text = textInput.value;
    charCount.textContent = `글자 수: ${text.length.toLocaleString()}`;
}

function saveSpeakerName() {
    try {
        localStorage.setItem('kpag_speaker_name', speakerName.value);
    } catch (e) {
        console.log('localStorage not supported');
    }
}

function loadSpeakerName() {
    try {
        const savedName = localStorage.getItem('kpag_speaker_name');
        if (savedName) {
            speakerName.value = savedName;
        }
    } catch (e) {
        console.log('localStorage not supported');
    }
}

// CSV 다운로드
function handleDownload() {
    if (parsedData.length === 0) {
        showError('다운로드할 데이터가 없습니다.');
        return;
    }

    const headers = ['날짜', '시간', '예식장홀', '신랑', '신부', '연락처', '브랜드', '상품', '업체', '플래너', '요청사항'];
    const csvContent = [
        headers.join(','),
        ...parsedData.map(row => 
            headers.map(header => {
                const value = row[header] || '';
                return `"${value.replace(/"/g, '""')}"`;
            }).join(',')
        )
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `KPAG_스케줄_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showSuccess('CSV 파일이 다운로드되었습니다.');
}

// =============================================================================
// 디버깅 함수들
// =============================================================================

function testSingleBlock(blockText) {
    console.log('=== 단일 블록 테스트 시작 ===');
    const lines = blockText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    console.log('입력 라인들:', lines);
    
    const filteredLines = lines.filter(line => isValidScheduleLine(line));
    console.log('필터링된 라인들:', filteredLines);
    
    const isValid = isValidScheduleBlock(filteredLines);
    console.log('블록 유효성:', isValid);
    
    if (isValid) {
        const parsed = parseCompleteSchedule(filteredLines);
        console.log('파싱 결과:', parsed);
        return parsed;
    } else {
        console.log('블록이 유효하지 않음');
        return null;
    }
}

function debugChangeDetection(chatText, targetSpeaker) {
    console.log('=== 변경사항 감지 디버깅 ===');
    
    const speakers = extractSpeakerMessages(chatText);
    const finalSpeaker = targetSpeaker || speakers.speakers[0];
    
    if (!speakers.messages[finalSpeaker]) {
        console.log('화자를 찾을 수 없음');
        return;
    }
    
    const managerMessages = speakers.messages[finalSpeaker];
    console.log(`${finalSpeaker}의 메시지 ${managerMessages.length}개 분석 중...`);
    
    const allScheduleBlocks = [];
    
    managerMessages.forEach((message, messageIndex) => {
        console.log(`\n--- 메시지 ${messageIndex} (시간: ${message.time}) ---`);
        const messageBlocks = extractScheduleBlocksFromMessage(message.content, messageIndex);
        
        messageBlocks.forEach((block, blockIndex) => {
            console.log(`\n블록 ${blockIndex} (messageIndex: ${block.messageIndex}):`);
            console.log('첫 3 라인:', block.lines.slice(0, 3));
        });
        
        allScheduleBlocks.push(...messageBlocks);
    });
    
    const validBlocks = allScheduleBlocks.filter(block => 
        isValidScheduleBlock(block.lines)
    );
    
    console.log(`\n총 ${allScheduleBlocks.length}개 블록 발견, 유효한 블록: ${validBlocks.length}개`);
    
    return detectChanges(validBlocks);
}

// =============================================================================
// 이벤트 리스너 등록 및 초기화
// =============================================================================

// 이벤트 리스너들
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);
fileInput.addEventListener('change', handleFileSelect);
textInput.addEventListener('input', updateCharCount);
speakerName.addEventListener('input', saveSpeakerName);
parseBtn.addEventListener('click', handleParse);
downloadBtn.addEventListener('click', handleDownload);
expandBtn.addEventListener('click', () => fullscreenModal.style.display = 'block');
closeModal.addEventListener('click', () => fullscreenModal.style.display = 'none');

fullscreenModal.addEventListener('click', (e) => {
    if (e.target === fullscreenModal) {
        fullscreenModal.style.display = 'none';
    }
});

// 초기화
updateCharCount();
loadSpeakerName();
updateTableHeaders();

// 디버깅 함수들을 전역에 노출
window.testSingleBlock = testSingleBlock;
window.isValidScheduleLine = isValidScheduleLine;
window.isValidScheduleBlock = isValidScheduleBlock;
window.parseCompleteSchedule = parseCompleteSchedule;
window.splitTwoNames = splitTwoNames;
window.debugChangeDetection = debugChangeDetection;

console.log('🎉 KPAG 파서가 준비되었습니다!');
console.log('디버깅 함수:');
console.log('- testSingleBlock(blockText) : 단일 블록 테스트');
console.log('- debugChangeDetection(chatText, speaker) : 변경사항 감지 디버깅');