#!/usr/bin/env node
/**
 * KPAG 웨딩 촬영 데이터 관리용 MCP 서버
 * Notion 데이터베이스와 연동하여 촬영 일정을 자동으로 입력/계산
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
class KPAGPricingEngine {
    pricingRules = [
        {
            brand: "K 세븐스",
            basePrice: 140000,
            albumPrices: { "30P": 0 },
            locationSurcharge: {
                "창원": 50000,
                "울산": 50000,
                "김해": 20000,
                "양산": 20000
            },
            specialRules: {
                "양산 M웨딩컨벤션": 200000
            }
        },
        {
            brand: "B 세븐스",
            basePrice: 160000,
            albumPrices: { "30P": 0, "40P": 40000 },
            locationSurcharge: {
                "창원": 50000,
                "울산": 50000,
                "김해": 20000,
                "양산": 20000
            },
            specialRules: {}
        },
        {
            brand: "세컨드플로우",
            basePrice: 190000,
            albumPrices: { "기본 40P": 0, "50P": 50000, "30P": -20000 },
            locationSurcharge: {},
            specialRules: {
                "아시아드": 170000, // 30P 특수가격
                "그랜드블랑 미라벨": 210000, // 드레스실 +2만원
                "그랜드블랑 카로스": 210000,
                "그랜드블랑 퀸덤": 210000
            }
        },
        {
            brand: "더그라피",
            basePrice: 190000,
            albumPrices: { "기본 40P": 0, "50P": 50000 },
            locationSurcharge: {},
            specialRules: {
                "그랜드블랑 미라벨": 210000,
                "그랜드블랑 카로스": 210000,
                "그랜드블랑 퀸덤": 210000
            }
        },
        {
            brand: "A 세븐스프리미엄",
            basePrice: 240000,
            albumPrices: { "40P": 0 },
            locationSurcharge: {},
            specialRules: {}
        }
    ];
    calculatePrice(brand, album, venue) {
        const rule = this.pricingRules.find(r => r.brand === brand);
        if (!rule)
            throw new Error(`알 수 없는 브랜드: ${brand}`);
        // 특수 예식장 규칙 확인
        const specialPrice = Object.entries(rule.specialRules).find(([key, _]) => venue.includes(key));
        if (specialPrice) {
            return specialPrice[1];
        }
        // 기본 계산: 기본가격 + 앨범가격 + 지역 출장비
        let price = rule.basePrice;
        if (rule.albumPrices[album] !== undefined) {
            price += rule.albumPrices[album];
        }
        // 지역별 출장비 계산
        const location = Object.keys(rule.locationSurcharge).find(loc => venue.includes(loc));
        if (location) {
            price += rule.locationSurcharge[location];
        }
        // 아시아드 30P 특수 케이스
        if (brand === "세컨드플로우" && album === "30P" && venue.includes("아시아드")) {
            return 170000;
        }
        return price;
    }
}
class KPAGMessageParser {
    parseManagerMessage(message) {
        const lines = message.trim().split('\n').map(line => line.trim());
        const data = {
            숙지사항: []
        };
        // 날짜 추출
        const dateMatch = lines[0].match(/(\d{4}\.\d{2}\.\d{2})/);
        if (dateMatch) {
            // 시간 추출
            const timeMatch = lines.find(line => line.match(/(\d{1,2}):(\d{2})/));
            const timeStr = timeMatch ? timeMatch.match(/(\d{1,2}):(\d{2})/)?.[0] : "12:00";
            const [year, month, day] = dateMatch[1].split('.');
            data.일시 = `${year}-${month}-${day}T${timeStr}:00.000+09:00`;
        }
        // 예식장 추출
        const venueMatch = lines.find(line => !line.match(/\d{4}\.\d{2}\.\d{2}/) &&
            !line.match(/\d{1,2}:\d{2}/) &&
            !line.includes('010-') &&
            !line.includes('세븐스') &&
            !line.includes('세컨') &&
            !line.includes('안현우') &&
            line.length > 2);
        if (venueMatch) {
            data.예식장 = venueMatch.replace(/\(.*?\)/g, '').trim();
        }
        // 신랑신부 추출 (한글 이름 2개)
        const nameMatch = lines.find(line => {
            const koreanNames = line.match(/[가-힣]{2,4}\s+[가-힣]{2,4}/);
            return koreanNames && !line.includes('010-');
        });
        if (nameMatch) {
            data.신랑신부 = nameMatch.match(/[가-힣]{2,4}\s+[가-힣]{2,4}/)?.[0] || '';
        }
        // 연락처 추출
        const phoneMatch = lines.find(line => line.includes('010-'));
        if (phoneMatch) {
            data.연락처 = phoneMatch.match(/010-[\d-]+/)?.[0];
        }
        // 브랜드 및 앨범 추출
        const productLine = lines.find(line => line.includes('세븐스') || line.includes('세컨') || line.includes('그라피'));
        if (productLine) {
            if (productLine.includes('K') && productLine.includes('세븐스')) {
                data.브랜드 = 'K 세븐스';
            }
            else if (productLine.includes('B') && productLine.includes('세븐스')) {
                data.브랜드 = 'B 세븐스';
            }
            else if (productLine.includes('A') && productLine.includes('세븐스')) {
                data.브랜드 = 'A 세븐스프리미엄';
            }
            else if (productLine.includes('세컨')) {
                data.브랜드 = '세컨드플로우';
            }
            else if (productLine.includes('그라피')) {
                data.브랜드 = '더그라피';
            }
            // 앨범 추출
            if (productLine.includes('30P')) {
                data.앨범 = productLine.includes('기본') ? '기본 30P' : '30P';
            }
            else if (productLine.includes('40P')) {
                data.앨범 = productLine.includes('기본') ? '기본 40P' : '40P';
            }
            else if (productLine.includes('50P')) {
                data.앨범 = productLine.includes('기본') ? '기본 50P' : '50P';
            }
        }
        // 작가 추출
        const photographerMatch = lines.find(line => line.includes('안현우'));
        if (photographerMatch) {
            data.작가 = '안현우';
        }
        // 플래너 추출
        const plannerMatch = lines.find(line => line.includes('w') || line.includes('그랜드블랑'));
        if (plannerMatch) {
            data.플래너 = plannerMatch.trim();
        }
        // 숙지사항 추출
        const specialNotes = lines.join(' ');
        if (specialNotes.includes('선촬영'))
            data.숙지사항.push('선촬영');
        if (specialNotes.includes('폐백') && !specialNotes.includes('폐백X') && !specialNotes.includes('폐백 X')) {
            data.숙지사항.push('폐백');
        }
        if (specialNotes.includes('포토부스'))
            data.숙지사항.push('포토부스');
        if (specialNotes.includes('플래시컷'))
            data.숙지사항.push('플래시컷');
        if (specialNotes.includes('드레스실') || specialNotes.includes('드래스룸')) {
            data.숙지사항.push('드래스룸');
        }
        if (specialNotes.includes('홀스냅'))
            data.숙지사항.push('홀스냅');
        // 전달사항 생성
        const additionalInfo = [];
        if (message.includes('지하'))
            additionalInfo.push('지하1층');
        if (message.includes('미니북'))
            additionalInfo.push('미니북 2권');
        if (message.includes('폐백X') || message.includes('폐백 X'))
            additionalInfo.push('폐백X');
        data.전달사항 = additionalInfo.join(', ');
        return data;
    }
}
const server = new Server({
    name: 'notion-kpag-data-write',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
const pricingEngine = new KPAGPricingEngine();
const messageParser = new KPAGMessageParser();
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'parse_manager_message',
                description: '매니저로부터 받은 촬영 일정 메시지를 파싱하여 구조화된 데이터로 변환',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: {
                            type: 'string',
                            description: '매니저가 보낸 촬영 일정 메시지 텍스트'
                        }
                    },
                    required: ['message']
                }
            },
            {
                name: 'calculate_shooting_price',
                description: '브랜드, 앨범, 예식장 정보를 바탕으로 촬영 예상단가 계산',
                inputSchema: {
                    type: 'object',
                    properties: {
                        brand: {
                            type: 'string',
                            description: '브랜드명 (K 세븐스, B 세븐스, 세컨드플로우, 더그라피, A 세븐스프리미엄)'
                        },
                        album: {
                            type: 'string',
                            description: '앨범 타입 (30P, 40P, 50P, 기본 40P 등)'
                        },
                        venue: {
                            type: 'string',
                            description: '예식장명'
                        }
                    },
                    required: ['brand', 'album', 'venue']
                }
            },
            {
                name: 'create_notion_shooting_data',
                description: '파싱된 촬영 데이터를 Notion KPAG 데이터베이스에 새 페이지로 생성',
                inputSchema: {
                    type: 'object',
                    properties: {
                        shootingData: {
                            type: 'object',
                            properties: {
                                신랑신부: { type: 'string' },
                                일시: { type: 'string' },
                                예식장: { type: 'string' },
                                연락처: { type: 'string' },
                                작가: { type: 'string' },
                                브랜드: { type: 'string' },
                                앨범: { type: 'string' },
                                플래너: { type: 'string' },
                                예상단가: { type: 'number' },
                                전달사항: { type: 'string' },
                                숙지사항: { type: 'array', items: { type: 'string' } }
                            },
                            required: ['신랑신부', '일시', '예식장', '브랜드', '앨범', '예상단가']
                        }
                    },
                    required: ['shootingData']
                }
            },
            {
                name: 'validate_shooting_data',
                description: '촬영 데이터의 유효성 검증 (필수 필드, 단가 정확성 등 확인)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        shootingData: {
                            type: 'object',
                            description: '검증할 촬영 데이터 객체'
                        }
                    },
                    required: ['shootingData']
                }
            }
        ]
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // args가 undefined인 경우 체크
    if (!args) {
        return {
            content: [
                {
                    type: 'text',
                    text: '❌ 오류 발생: 필수 인자가 제공되지 않았습니다.'
                }
            ],
            isError: true,
        };
    }
    try {
        switch (name) {
            case 'parse_manager_message': {
                if (!('message' in args) || typeof args.message !== 'string') {
                    throw new Error('message 파라미터가 필요합니다.');
                }
                const message = args.message;
                const parsedData = messageParser.parseManagerMessage(message);
                // 단가 자동 계산
                if (parsedData.브랜드 && parsedData.앨범 && parsedData.예식장) {
                    parsedData.예상단가 = pricingEngine.calculatePrice(parsedData.브랜드, parsedData.앨범, parsedData.예식장);
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: `📋 매니저 메시지 파싱 결과:\n\n${JSON.stringify(parsedData, null, 2)}`
                        }
                    ]
                };
            }
            case 'calculate_shooting_price': {
                if (!('brand' in args) || !('album' in args) || !('venue' in args)) {
                    throw new Error('brand, album, venue 파라미터가 모두 필요합니다.');
                }
                if (typeof args.brand !== 'string' || typeof args.album !== 'string' || typeof args.venue !== 'string') {
                    throw new Error('brand, album, venue는 문자열이어야 합니다.');
                }
                const { brand, album, venue } = args;
                const price = pricingEngine.calculatePrice(brand, album, venue);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `💰 ${brand} ${album} @${venue}\n예상단가: ${price.toLocaleString()}원`
                        }
                    ]
                };
            }
            case 'create_notion_shooting_data': {
                if (!('shootingData' in args) || typeof args.shootingData !== 'object') {
                    throw new Error('shootingData 파라미터가 필요합니다.');
                }
                const shootingData = args.shootingData;
                // 실제 Notion API 호출은 여기서 구현
                // 현재는 시뮬레이션
                const notionData = {
                    parent: { database_id: "9915f43a-dcb7-49aa-bb91-eaf443b3f530" },
                    properties: {
                        "신랑 신부": { title: [{ text: { content: shootingData.신랑신부 } }] },
                        "일시": { date: { start: shootingData.일시 } },
                        "예식장": { rich_text: [{ text: { content: shootingData.예식장 } }] },
                        "연락처": shootingData.연락처 ? { phone_number: shootingData.연락처 } : null,
                        "브랜드": { select: { name: shootingData.브랜드 } },
                        "앨범": { rich_text: [{ text: { content: shootingData.앨범 } }] },
                        "작가": { multi_select: [{ name: shootingData.작가 }] },
                        "플래너": { rich_text: [{ text: { content: shootingData.플래너 } }] },
                        "예상단가": { number: shootingData.예상단가 },
                        "전달사항": { rich_text: [{ text: { content: shootingData.전달사항 || "" } }] },
                        "숙지사항": { multi_select: shootingData.숙지사항.map(item => ({ name: item })) }
                    }
                };
                return {
                    content: [
                        {
                            type: 'text',
                            text: `✅ Notion 페이지 생성 준비 완료\n\n${JSON.stringify(notionData, null, 2)}`
                        }
                    ]
                };
            }
            case 'validate_shooting_data': {
                if (!('shootingData' in args)) {
                    throw new Error('shootingData 파라미터가 필요합니다.');
                }
                const shootingData = args.shootingData;
                const errors = [];
                if (!shootingData || typeof shootingData !== 'object') {
                    errors.push('유효하지 않은 촬영 데이터 형식');
                }
                else {
                    if (!shootingData.신랑신부)
                        errors.push('신랑신부 정보 누락');
                    if (!shootingData.일시)
                        errors.push('일시 정보 누락');
                    if (!shootingData.예식장)
                        errors.push('예식장 정보 누락');
                    if (!shootingData.브랜드)
                        errors.push('브랜드 정보 누락');
                    if (!shootingData.앨범)
                        errors.push('앨범 정보 누락');
                    if (!shootingData.예상단가 || shootingData.예상단가 <= 0)
                        errors.push('예상단가 정보 누락/오류');
                }
                const isValid = errors.length === 0;
                return {
                    content: [
                        {
                            type: 'text',
                            text: `🔍 데이터 검증 결과: ${isValid ? '✅ 유효함' : '❌ 오류 발견'}\n\n${errors.length > 0 ? `오류 목록:\n${errors.map(e => `• ${e}`).join('\n')}` : '모든 필수 필드가 정상적으로 입력되었습니다.'}`
                        }
                    ]
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `❌ 오류 발생: ${error instanceof Error ? error.message : String(error)}`
                }
            ],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('KPAG Notion Data Write MCP Server running on stdio');
}
main().catch((error) => {
    console.error('서버 시작 중 오류:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map