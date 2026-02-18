import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './supabaseClient'
import { Train, Calendar, Clock, LogOut, PlusCircle, List, Trash2, ChevronRight, Search, Edit2, X } from 'lucide-react'
import './App.css'

// --- ODPT API 設定 ---
const API_KEY = 'od5dwqe1ja91vjtdq6uij9tfgqhrce8wgzx20jt76z68tswjetzgxtfxqng09vwx';
const BASE_URL = 'https://api-challenge.odpt.org/api/v4';
const GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbz-pqpXHL4WVQpWApwHBq2zQz2lDDODt3MLPXdxboLje3NoAUXZ-wuNA-LK51ILYpVp/exec';

function App() {
  const [session, setSession] = useState(null)
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('record')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState(null)

  // API用のマスターデータ
  const [railwayMaster, setRailwayMaster] = useState([]);

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)

  const [formData, setFormData] = useState({
    ride_date: new Date().toISOString().split('T')[0],
    railway_company: '', line_name: '', destination: '', train_number: '',
    operation_number: '', formation_number: '', service_type: '',
    service_color: 'bg-skyblue',
    // 複数区間対応: segmentsは配列で区間情報を保持
    segments: [],
    car_number: '', departure_station: '', arrival_station: '',
    departure_time: '', arrival_time: '',
    // 遅延情報
    is_delayed: false, delay_minutes: '',
    memo: ''
  })

  const [isCompact, setIsCompact] = useState(false);
  const [multipleSegments, setMultipleSegments] = useState(false);
  const [tempSegment, setTempSegment] = useState({ railway_company: '', line_name: '', service_type: '', destination: '', service_color: 'bg-skyblue' });

  // --- 路線・種別の正規化ヘルパー関数 ---
  const getNormalizedInfo = (line, service) => {
    let newLine = line;
    let newService = service;

    // 1. 路線名の修正
    if (newLine === '京浜東北線・根岸線') {
      newLine = '京浜東北・根岸線';
    } else if (newLine === '埼京線・川越線') {
      newLine = '埼京・川越線';
    }

    // 2. 種別の「各駅停車」→「普通」変換
    const keepLocalLines = [
      '京浜東北・根岸線', '横浜線', '南武線', '中央・総武各駅停車',
      '埼京・川越線', '山手線', '京葉線', '相鉄直通線'
    ];

    if (newService === '各駅停車' && !keepLocalLines.includes(newLine)) {
      newService = '普通';
    }

    return { newLine, newService };
  };

  // --- 1. ODPT マスターデータの取得 ---
  useEffect(() => {
    const fetchMasterData = async () => {
      try {
        const res = await fetch(`${BASE_URL}/odpt:Railway?odpt:operator=odpt.Operator:JR-East&acl:consumerKey=${API_KEY}`);
        const data = await res.json();
        if (Array.isArray(data)) setRailwayMaster(data);
      } catch (err) {
        console.error("ODPT: 路線データの取得失敗", err);
      }
    };
    fetchMasterData();
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) setIsCompact(true);
      else setIsCompact(false);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchRides()
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchRides()
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (
      formData.line_name === '京浜東北・根岸線' &&
      formData.train_number &&
      !formData.formation_number
    ) {
      fetchFormationFromGAS(formData.train_number);
    }
  }, [formData.line_name, formData.train_number]);
  
  // 種別からデフォルト色を判定するヘルパー
  const getServiceColor = (type) => {
    if (!type) return 'bg-gray'
    if (type.includes('特急') || type.includes('快速') || type.includes('急行')) return 'bg-red'
    if (type.includes('普通') || type.includes('各駅停車')) return 'bg-blue'
    return 'bg-gray'
  }

  // --- 2. 自動補完ロジック (API連携) ---
  const autoFillFromAPI = useCallback(async (stationName, trainNo, targetField) => {
    if (railwayMaster.length === 0 || !stationName || !trainNo) return;

    const targetRailways = railwayMaster.filter(r =>
      r['odpt:stationOrder']?.some(s => s['odpt:stationTitle']?.['ja'] === stationName)
    );
    if (targetRailways.length === 0) return;

    const day = new Date(formData.ride_date).getDay();
    const calendar = (day === 0 || day === 6) ? 'SaturdayHoliday' : 'Weekday';
    const directions = ['Northbound', 'Southbound', 'Outbound', 'Inbound', 'Eastbound', 'Westbound'];

    for (const rail of targetRailways) {
      const railSuffix = rail['owl:sameAs'].split(':').pop();
      const stationObj = rail['odpt:stationOrder'].find(s => s['odpt:stationTitle']['ja'] === stationName);
      const stationId = stationObj['odpt:station'].split('.').pop();

      for (const dir of directions) {
        const timetableId = `odpt.StationTimetable:${railSuffix}.${stationId}.${dir}.${calendar}`;
        const url = `${BASE_URL}/odpt:StationTimetable?owl:sameAs=${timetableId}&acl:consumerKey=${API_KEY}`;

        try {
          const res = await fetch(url);
          const data = await res.json();
          if (!data || data.length === 0) continue;

          const trainData = data[0]['odpt:stationTimetableObject']?.find(t =>
            t['odpt:trainNumber']?.toUpperCase() === trainNo.toUpperCase()
          );

          if (trainData) {
            const typeMap = { 'Local': '各駅停車', 'Rapid': '快速', 'SpecialRapid': '特別快速' };
            const typeRaw = trainData['odpt:trainType'].split('.').pop();
            const rawServiceType = typeMap[typeRaw] || typeRaw;
            const rawLineName = rail['odpt:railwayTitle']['ja'];

            // 正規化を適用
            const { newLine, newService } = getNormalizedInfo(rawLineName, rawServiceType);

            // 【追加】過去の履歴から色を推測
            const colorMatch = rides.find(r => r.line_name === newLine && r.service_type === newService);
            const inferredColor = colorMatch ? colorMatch.service_color : getServiceColor(newService);

            const destStationId = trainData['odpt:destinationStation'][0];
            let destName = "";
            railwayMaster.forEach(r => {
              const found = r['odpt:stationOrder']?.find(s => s['odpt:station'] === destStationId);
              if (found) destName = found['odpt:stationTitle']['ja'];
            });

            if (targetField === 'departure') {
              setFormData(prev => ({
                ...prev,
                departure_time: trainData['odpt:departureTime'],
                line_name: newLine,
                railway_company: 'JR東日本',
                service_type: newService,
                service_color: inferredColor, // 色を自動適用
                destination: destName
              }));
            } else if (targetField === 'arrival') {
              setFormData(prev => ({ ...prev, arrival_time: trainData['odpt:departureTime'] }));
            }
            return;
          }
        } catch (e) { console.error(e); }
      }
    }
  }, [railwayMaster, formData.ride_date, rides]); // ridesを依存関係に追加

  const suggestions = useMemo(() => {
    const getUnique = (key) => [...new Set(rides.map(r => r[key]).filter(Boolean))]
    // segments内の候補も抽出
    const segLines = [...new Set(rides.flatMap(r => (r.segments || []).map(s => s.line_name)).filter(Boolean))]
    const segServices = [...new Set(rides.flatMap(r => (r.segments || []).map(s => s.service_type)).filter(Boolean))]
    const segCompanies = [...new Set(rides.flatMap(r => (r.segments || []).map(s => s.railway_company)).filter(Boolean))]
    const companies = [...new Set([...getUnique('railway_company'), ...segCompanies].filter(Boolean))]
    // 履歴に保存したときに "路線A → 路線B" のように結合している値が混ざることがあるため、候補から除外する
    const isCompound = v => /→|->/.test(v)
    const lines = [...new Set([...getUnique('line_name'), ...segLines].filter(Boolean))].filter(l => !isCompound(l))
    const services = [...new Set([...getUnique('service_type'), ...segServices].filter(Boolean))].filter(s => !isCompound(s))
    const stations = [...new Set([...rides.map(r => r.departure_station), ...rides.map(r => r.arrival_station)].filter(Boolean))]
    return { companies, lines, services, stations }
  }, [rides])

  // 区間エディタ用ハンドラ
  const handleAddSegment = (segment) => {
    setFormData(prev => ({ ...prev, segments: [...(prev.segments || []), segment] }))
  }

  const handleRemoveSegment = (index) => {
    setFormData(prev => ({ ...prev, segments: prev.segments.filter((_, i) => i !== index) }))
  }

  const handleSegmentChange = (index, field, value) => {
    setFormData(prev => {
      const next = (prev.segments || []).map((s, i) => i === index ? { ...s, [field]: value } : s)
      return { ...prev, segments: next }
    })
  }

  const commitTempSegment = () => {
    // 正規化して色推測してから追加
    const { newLine, newService } = getNormalizedInfo(tempSegment.line_name, tempSegment.service_type)
    const colorMatch = rides.find(r => r.line_name === newLine && r.service_type === newService)
    // 優先順位: 既存履歴の色 -> 現在フォームの選択色 -> 種別推定色
    const inferredColor = colorMatch ? colorMatch.service_color : (formData.service_color || tempSegment.service_color || getServiceColor(newService))
    const seg = { ...tempSegment, line_name: newLine, service_type: newService, service_color: inferredColor }
    handleAddSegment(seg)
    setTempSegment({ railway_company: '', line_name: '', service_type: '', destination: '', service_color: 'bg-skyblue' })
  }

  const fetchFormationFromGAS = async (trainNo) => {
    try {
      const res = await fetch(
        `${GAS_WEBAPP_URL}?train=${encodeURIComponent(trainNo)}`
      );
      const data = await res.json();

      if (
        data?.result &&
        !data.result.includes('未') &&
        !data.result.includes('エラー')
      ) {
        setFormData(prev => ({
          ...prev,
          formation_number: data.result
        }));
      }
    } catch {
      // 失敗時は何もしない
    }
  };

  // --- 3. 入力ハンドラー ---
  const handleInputChange = (field, value) => {
    let updatedFormData = { ...formData, [field]: value };

    if (field === 'line_name' || field === 'service_type') {
      const { newLine, newService } = getNormalizedInfo(updatedFormData.line_name, updatedFormData.service_type);
      updatedFormData.line_name = newLine;
      updatedFormData.service_type = newService;

      // 手入力時も色推測を適用
      const match = rides.find(r => r.line_name === updatedFormData.line_name && r.service_type === updatedFormData.service_type);
      if (match && match.service_color) {
        updatedFormData.service_color = match.service_color;
      }
    }

    setFormData(updatedFormData);

    if (field === 'departure_station' || field === 'train_number') {
      const s = field === 'departure_station' ? value : formData.departure_station;
      const t = field === 'train_number' ? value : formData.train_number;
      if (s && t) autoFillFromAPI(s, t, 'departure');
    }
    if (field === 'arrival_station' && formData.train_number) {
      autoFillFromAPI(value, formData.train_number, 'arrival');
    }
  };

  const fetchRides = async () => {
    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .order('ride_date', { ascending: false })
      .order('departure_time', { ascending: true })
      .order('created_at', { ascending: true })
    if (!error) setRides(data)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    // segments がある場合は互換フィールドを上書きして保存
    const payload = { ...formData, user_id: session.user.id }
    if (formData.segments && formData.segments.length > 0) {
      const segs = formData.segments
      payload.line_name = segs.map(s => s.line_name).filter(Boolean).join(' → ')
      payload.service_type = segs.map(s => s.service_type).filter(Boolean).join(' → ')
      payload.service_color = segs[0].service_color || getServiceColor(segs[0].service_type)
    }
    let error;
    if (editingId) {
      const result = await supabase.from('rides').update(payload).eq('id', editingId)
      error = result.error
    } else {
      const result = await supabase.from('rides').insert([payload])
      error = result.error
    }
    if (!error) {
      alert(editingId ? '更新しました！' : '記録しました！')
      setEditingId(null)
      fetchRides()
      setFormData(prev => ({
        ...prev, train_number: '', operation_number: '', formation_number: '',
        car_number: '', departure_station: prev.arrival_station,
        arrival_station: '', departure_time: '', arrival_time: '',
        is_delayed: false, delay_minutes: '', memo: '',
        segments: []
      }))
      setMultipleSegments(false)
      setTempSegment({ railway_company: '', line_name: '', service_type: '', destination: '', service_color: 'bg-skyblue' })
      setActiveTab('history')
    } else {
      alert('エラー: ' + error.message)
    }
    setLoading(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('この記録を削除しますか？')) return
    const { error } = await supabase.from('rides').delete().eq('id', id)
    if (!error) fetchRides()
  }

  const handleEditStart = (ride) => {
    setEditingId(ride.id)
    // 既にsegmentsがある場合は配列として扱う
    const rideSegments = ride.segments && typeof ride.segments === 'string' ? JSON.parse(ride.segments) : ride.segments
    const base = { ...ride, service_color: ride.service_color || getServiceColor(ride.service_type) }
    if (rideSegments && rideSegments.length > 0) {
      base.segments = rideSegments
      setMultipleSegments(true)
    } else {
      base.segments = []
      setMultipleSegments(false)
    }
    setFormData(base)
    setActiveTab('record')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setFormData({
      ride_date: new Date().toISOString().split('T')[0],
      railway_company: '', line_name: '', destination: '', train_number: '',
      operation_number: '', formation_number: '', service_type: '',
      service_color: 'bg-skyblue',
      car_number: '', departure_station: '', arrival_station: '',
      departure_time: '', arrival_time: '', is_delayed: false, delay_minutes: '', memo: '', segments: []
    })
    setMultipleSegments(false)
    setTempSegment({ railway_company: '', line_name: '', service_type: '', destination: '', service_color: 'bg-skyblue' })
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setLoading(true)
    const result = isSignUp ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password })
    if (result.error) alert(result.error.message)
    setLoading(false)
  }

  const renderServiceType = (type) => {
    if (!type) return '普通';
    const target = "Fライナー";
    if (type.includes(target)) {
      const parts = type.split(target);
      return (
        <span className="service-with-logo" style={{ display: 'inline-flex', alignItems: 'center' }}>
          {parts[0]}
          <img src="/train_record/Fライナー.png" alt="Fライナー" className="f-liner-logo" />
          {parts[1]}
        </span>
      );
    }
    return type;
  };

  const computeDelayedTime = (timeStr, delayMinutes) => {
    if (!timeStr) return ''
    const hhmm = timeStr.slice(0, 5)
    const [hhRaw, mmRaw] = hhmm.split(':')
    const hh = parseInt(hhRaw || '0', 10)
    const mm = parseInt(mmRaw || '0', 10)
    const delay = parseInt(delayMinutes || '0', 10)
    if (isNaN(hh) || isNaN(mm) || isNaN(delay)) return hhmm
    const total = hh * 60 + mm + delay
    const newH = Math.floor(total / 60) % 24
    const newM = total % 60
    const pad = (n) => n.toString().padStart(2, '0')
    return `${pad(newH)}:${pad(newM)}`
  }

  const filteredRides = useMemo(() => {
    const query = searchQuery.toLowerCase()
    return rides.filter(ride =>
      ride.line_name?.toLowerCase().includes(query) ||
      ride.formation_number?.toLowerCase().includes(query) ||
      ride.railway_company?.toLowerCase().includes(query) ||
      ride.train_number?.toLowerCase().includes(query) ||
      ride.departure_station?.toLowerCase().includes(query) ||
      ride.arrival_station?.toLowerCase().includes(query) ||
      ride.destination?.toLowerCase().includes(query) ||
      ride.memo?.toLowerCase().includes(query)
    )
  }, [rides, searchQuery])

  const groupedRides = useMemo(() => {
    const groups = {}
    filteredRides.forEach(ride => {
      const date = ride.ride_date
      if (!groups[date]) groups[date] = []
      groups[date].push(ride)
    })
    return groups
  }, [filteredRides])

  if (!session) {
    return (
      <div className="container auth-container">
        <div className="card text-center auth-card">
          <div className="auth-logo">🚆</div>
          <h1 className="auth-title">乗車記録</h1>
          <form onSubmit={handleAuth} className="auth-form">
            <input type="email" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit" className="primary" disabled={loading}>{isSignUp ? '新規登録' : 'ログイン'}</button>
          </form>
          <button onClick={() => setIsSignUp(!isSignUp)} className="text-btn">{isSignUp ? 'ログイン画面へ' : '新規登録画面へ'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="container main-app">
      <header className="app-header">
        <h2 className="logo">乗車記録</h2>
        <button onClick={() => supabase.auth.signOut()} className="icon-btn-logout"><LogOut size={18} /></button>
      </header>

      {activeTab === 'record' ? (
        <div className="card fade-in">
          <h3 className="section-title">
            {editingId ? <Edit2 size={18} /> : <PlusCircle size={18} />}
            <span>{editingId ? ' 記録を編集' : ' 新規乗車記録'}</span>
          </h3>
          <form onSubmit={handleSubmit} className="ride-form">
            <datalist id="company-list">{suggestions.companies.map(s => <option key={s} value={s} />)}</datalist>
            <datalist id="line-list">{suggestions.lines.map(s => <option key={s} value={s} />)}</datalist>
            <datalist id="service-list">{suggestions.services.map(s => <option key={s} value={s} />)}</datalist>
            <datalist id="station-list">{suggestions.stations.map(s => <option key={s} value={s} />)}</datalist>

            <div className="input-group">
              <label>日付<input style={{ width: '80%' }} type="date" value={formData.ride_date} onChange={(e) => handleInputChange('ride_date', e.target.value)} required /></label>
              <label>会社名<input type="text" list="company-list" placeholder="鉄道会社" value={formData.railway_company} onChange={(e) => handleInputChange('railway_company', e.target.value)} /></label>
            </div>

            <div className="input-group">
              {!multipleSegments ? (
                <>
                  <input type="text" list="line-list" placeholder="路線名" value={formData.line_name} onChange={(e) => handleInputChange('line_name', e.target.value)} />
                  <input type="text" list="service-list" placeholder="種別" value={formData.service_type} onChange={(e) => handleInputChange('service_type', e.target.value)} />
                  <button type="button" className="text-btn" onClick={() => {
                    setMultipleSegments(true)
                    setTempSegment({ railway_company: formData.railway_company, line_name: formData.line_name, service_type: formData.service_type, destination: formData.destination, service_color: formData.service_color || 'bg-skyblue' })
                    // 既存トップレベルはクリアして区間ベースに移行
                    setFormData(prev => ({ ...prev, line_name: '', service_type: '', service_color: 'bg-skyblue' }))
                  }}>区間を追加</button>
                </>
              ) : (
                <div style={{ width: '100%', gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', justifyContent: 'center' }}>
                    <input style={{ flex: 1.2, minWidth: 0 }} type="text" list="company-list" placeholder="会社名" value={tempSegment.railway_company} onChange={(e) => setTempSegment({ ...tempSegment, railway_company: e.target.value })} />
                    <input style={{ flex: 1.6, minWidth: 0 }} type="text" list="line-list" placeholder="区間の路線名" value={tempSegment.line_name} onChange={(e) => setTempSegment({ ...tempSegment, line_name: e.target.value })} />
                    <input style={{ flex: 1, minWidth: 0 }} type="text" list="service-list" placeholder="区間の種別" value={tempSegment.service_type} onChange={(e) => setTempSegment({ ...tempSegment, service_type: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <button type="button" className="primary" onClick={commitTempSegment}>区間を追加</button>
                      <button type="button" className="text-btn" onClick={() => { setMultipleSegments(false); setTempSegment({ railway_company: '', line_name: '', service_type: '', destination: '', service_color: 'bg-skyblue' }) }}>区間編集をやめる</button>
                    </div>
                  </div>
                  {formData.segments && formData.segments.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {formData.segments.map((s, i) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', gap: '0px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: '0px', alignItems: 'baseline' }}>
                              <span style={{fontSize: '12px'}}>{s.railway_company || formData.railway_company}</span>
                              <span className='info-line' style={{fontSize: '16px', fontWeight: 500 }}>{s.line_name}</span>
                            </div>
                            <div style={{ marginLeft: 8 }}>
                              <span className={`badge ${!s.service_color?.startsWith('#') ? (s.service_color || getServiceColor(s.service_type)) : ''}`} style={s.service_color?.startsWith('#') ? { backgroundColor: s.service_color } : {}}>{renderServiceType(s.service_type)}</span>
                            </div>
                            <div style={{ marginLeft: 'auto' }}>
                              <button type="button" className="text-btn" onClick={() => handleRemoveSegment(i)}>削除</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="color-selector">
              {['bg-skyblue', 'bg-red', 'bg-orange', 'bg-green', 'bg-purple', 'bg-gray'].map(color => (
                <button
                  key={color}
                  type="button"
                  className={`color-dot ${color} ${formData.service_color === color ? 'active' : ''}`}
                  onClick={() => setFormData({ ...formData, service_color: color })}
                ></button>
              ))}
              <div className="custom-color-wrapper">
                <input
                  type="color"
                  id="customColor"
                  value={formData.service_color.startsWith('#') ? formData.service_color : '#cccccc'}
                  onChange={(e) => setFormData({ ...formData, service_color: e.target.value })}
                  className="custom-color-input"
                />
                <label htmlFor="customColor" className={`custom-color-label ${formData.service_color.startsWith('#') ? 'active' : ''}`}>🎨</label>
              </div>
            </div>

            <div className="input-group">
              <input type="text" list="station-list" placeholder="行先" value={formData.destination} onChange={(e) => handleInputChange('destination', e.target.value)} />
              <input type="text" placeholder="車番/号車" value={formData.car_number} onChange={(e) => handleInputChange('car_number', e.target.value)} />
            </div>

            <div className="input-group-three">
              <input type="text" placeholder="列番" value={formData.train_number} onChange={(e) => handleInputChange('train_number', e.target.value)} />
              <input type="text" placeholder="運番" value={formData.operation_number} onChange={(e) => handleInputChange('operation_number', e.target.value)} />
              <input type="text" placeholder="編成" value={formData.formation_number} onChange={(e) => handleInputChange('formation_number', e.target.value)} />
            </div>

            <div className="input-group">
              <input type="text" list="station-list" placeholder="乗車駅" value={formData.departure_station} onChange={(e) => handleInputChange('departure_station', e.target.value)} />
              <input type="text" list="station-list" placeholder="下車駅" value={formData.arrival_station} onChange={(e) => handleInputChange('arrival_station', e.target.value)} />
            </div>

            <div className="input-group">
              <label>発車時刻<input type="time" value={formData.departure_time} onChange={(e) => handleInputChange('departure_time', e.target.value)} style={{ width: '80%' }} /></label>
              <label>到着時刻<input type="time" value={formData.arrival_time} onChange={(e) => handleInputChange('arrival_time', e.target.value)} style={{ width: '80%' }} /></label>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <input type="checkbox" checked={formData.is_delayed} onChange={(e) => handleInputChange('is_delayed', e.target.checked)} /> 遅延
              </label>
              {formData.is_delayed && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  遅延分 <input type="number" min="0" value={formData.delay_minutes} onChange={(e) => handleInputChange('delay_minutes', e.target.value)} style={{ width: 80, padding: '6px', borderRadius: 6, border: '1px solid #ddd' }} /> 分
                </label>
              )}
            </div>

            <textarea placeholder="備考・メモ" value={formData.memo} onChange={(e) => handleInputChange('memo', e.target.value)} />

            <div className="button-row" style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="primary submit-btn" style={{ flex: 2 }}>{editingId ? '変更を保存' : '記録を保存'}</button>
              {editingId && <button type="button" onClick={handleCancelEdit} className="text-btn cancel-btn" style={{ flex: 1, textDecoration: 'none', background: '#eee', borderRadius: '12px', color: '#666', marginTop: 0 }}>キャンセル</button>}
            </div>
          </form>
        </div>
      ) : (
        <div className="fade-in">
          <div className="search-container card">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder={isCompact ? "" : "絞り込み..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
              style={{
                width: isCompact ? '0px' : '100%',
                padding: isCompact ? '0px' : '8px 12px',
                opacity: isCompact ? 0 : 1,
                marginLeft: isCompact ? '0px' : '8px'
              }}
            />
          </div>

          <div className="history-list">
            {Object.keys(groupedRides).length === 0 ? (
              <div className="empty-state">該当する記録がありません</div>
            ) : (
              Object.keys(groupedRides).sort((a, b) => b.localeCompare(a)).map(date => (
                <div key={date} className="history-date-group">
                  <div className="date-header">
                    <Calendar size={14} />
                    <span>{date.replace(/-/g, '/')}</span>
                    <span className="date-count">({groupedRides[date].length}件)</span>
                  </div>
                  {groupedRides[date].map(ride => (
                    <div key={ride.id} className="history-card card">
                      <div className="history-main">
                        <div className="history-time-col">
                          <div className="time-node">
                            ●{
                              ride.is_delayed && ride.delay_minutes ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' ,marginLeft: 5}}>
                                  <span style={{ color: '#636e72', textDecoration: 'line-through', fontSize: 9 }}>{ride.departure_time?.slice(0, 5)}</span>
                                  <span style={{ color: 'red', fontSize: 12, fontWeight: 600 }}>{computeDelayedTime(ride.departure_time, ride.delay_minutes)}</span>
                                </div>
                              ) : (
                                <span style={{ marginLeft: 6 }}>{ride.departure_time?.slice(0, 5)}</span>
                              )
                            }
                          </div>
                          <div className="time-line"></div>
                          <div className="time-node">
                            ■{
                              ride.is_delayed && ride.delay_minutes ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' ,marginLeft: 5}}>
                                  <span style={{ color: '#636e72', textDecoration: 'line-through', fontSize: 9 }}>{ride.arrival_time?.slice(0, 5)}</span>
                                  <span style={{ color: 'red', fontSize: 12, fontWeight: 600 }}>{computeDelayedTime(ride.arrival_time, ride.delay_minutes)}</span>
                                </div>
                              ) : (
                                <span style={{ marginLeft: 6 }}>{ride.arrival_time?.slice(0, 5)}</span>
                              )
                            }
                          </div>
                        </div>
                        <div className="history-info-col">
                          {(() => {
                            const rideSegments = ride.segments && typeof ride.segments === 'string' ? JSON.parse(ride.segments) : ride.segments
                            if (rideSegments && rideSegments.length > 0) {
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {rideSegments.map((s, idx) => (
                                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      <div className='info-top' style={{ display: 'flex', gap: '0px', alignItems: 'baseline' }}>
                                        <span className="info-company">{s.railway_company || ride.railway_company}<span className="info-line">{s.line_name}</span></span>
                                      </div>
                                      <div className='info-middle' style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                                        <span className={`badge ${!s.service_color?.startsWith('#') ? (s.service_color || getServiceColor(s.service_type)) : ''}`} style={s.service_color?.startsWith('#') ? { backgroundColor: s.service_color } : {}}>{renderServiceType(s.service_type)}</span>
                                        <span className='info-destination'>{ride.destination}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )
                            }
                            return (
                              <>
                                <div className="info-top">
                                  <span className="info-company">{ride.railway_company}<span className="info-line">{ride.line_name}</span></span>
                                </div>
                                <div className="info-middle">
                                  <span
                                    className={`badge ${!ride.service_color?.startsWith('#') ? (ride.service_color || getServiceColor(ride.service_type)) : ''}`}
                                    style={ride.service_color?.startsWith('#') ? { backgroundColor: ride.service_color } : {}}
                                  >{renderServiceType(ride.service_type)}</span>
                                  <span className="info-destination">{ride.destination && <span> {ride.destination}</span>}</span>
                                </div>
                              </>
                            )
                          })()}
                          <div className="info-stations">{ride.departure_station} <ChevronRight size={14} className="arrow-icon" /> {ride.arrival_station}</div>
                          <div className="info-details">{[ride.train_number, ride.operation_number, ride.formation_number, ride.car_number].filter(Boolean).join(' / ')}</div>
                          {ride.memo && <div className="info-memo">{ride.memo}</div>}
                        </div>
                        <div className="action-btns">
                          <button onClick={() => handleDelete(ride.id)} className="delete-btn"><Trash2 size={16} /></button>
                          <button onClick={() => handleEditStart(ride)} className="edit-btn" style={{ background: 'none', border: 'none', color: '#0984e3', cursor: 'pointer', padding: '5px' }}><Edit2 size={16} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <nav className="bottom-nav">
        <button className={activeTab === 'record' ? 'active' : ''} onClick={() => setActiveTab('record')}><PlusCircle size={24} /><span>記録</span></button>
        <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}><List size={24} /><span>履歴</span></button>
      </nav>
    </div>
  )
}

export default App