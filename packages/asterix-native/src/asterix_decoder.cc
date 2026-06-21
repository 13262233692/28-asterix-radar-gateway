#include "asterix_decoder.h"
#include <napi.h>
#include <cstring>
#include <atomic>

namespace asterix {

BitReader::BitReader(const uint8_t* data, size_t len)
    : data_(data), length_(len), byte_pos_(0), bit_pos_(0) {}

uint64_t BitReader::readBits(size_t n) {
    uint64_t result = 0;
    for (size_t i = 0; i < n; i++) {
        result = (result << 1) | (readBit() ? 1ULL : 0ULL);
    }
    return result;
}

uint32_t BitReader::readU32(size_t n) {
    if (n == 0) return 0;
    if (n > 32) n = 32;
    return static_cast<uint32_t>(readBits(n)) & ((n == 32) ? 0xFFFFFFFF : ((1U << n) - 1));
}

int32_t BitReader::readS32(size_t n) {
    if (n == 0 || n > 32) n = 32;
    uint32_t u = readU32(n);
    if (n < 32 && (u & (1U << (n - 1)))) {
        u |= 0xFFFFFFFF << n;
    }
    return static_cast<int32_t>(u);
}

uint16_t BitReader::readU16(size_t n) {
    return static_cast<uint16_t>(readU32(n));
}

uint8_t BitReader::readU8(size_t n) {
    return static_cast<uint8_t>(readU32(n));
}

uint16_t BitReader::readU16BE() {
    alignToByte();
    if (byte_pos_ + 1 >= length_) return 0;
    uint16_t v = (static_cast<uint16_t>(data_[byte_pos_]) << 8) |
                 static_cast<uint16_t>(data_[byte_pos_ + 1]);
    byte_pos_ += 2;
    bit_pos_ = 0;
    return v;
}

bool BitReader::readBit() {
    if (byte_pos_ >= length_) return false;
    bool bit = (data_[byte_pos_] >> (7 - bit_pos_)) & 0x01;
    bit_pos_++;
    if (bit_pos_ >= 8) {
        bit_pos_ = 0;
        byte_pos_++;
    }
    return bit;
}

void BitReader::skipBits(size_t n) {
    for (size_t i = 0; i < n && !eof(); i++) (void)readBit();
}

void BitReader::alignToByte() {
    if (bit_pos_ > 0) {
        bit_pos_ = 0;
        byte_pos_++;
    }
}

static inline double deg2rad(double d) { return d * M_PI / 180.0; }
static inline double rad2deg(double r) { return r * 180.0 / M_PI; }

double wgs84DistanceBearingToLat(double lat, double lon, double range_m,
                                 double bearing_deg, double& out_lat, double& out_lon) {
    const double R = 6371000.0;
    double brng = deg2rad(bearing_deg);
    double lat1 = deg2rad(lat);
    double lon1 = deg2rad(lon);
    double d = range_m / R;

    double lat2 = asin(sin(lat1) * cos(d) + cos(lat1) * sin(d) * cos(brng));
    double lon2 = lon1 + atan2(sin(brng) * sin(d) * cos(lat1),
                               cos(d) - sin(lat1) * sin(lat2));

    out_lat = rad2deg(lat2);
    out_lon = rad2deg(lon2);
    return 0.0;
}

TrackObjectPool::TrackObjectPool(Napi::Env env) : env_(env) {}

TrackObjectPool::~TrackObjectPool() {
    Napi::HandleScope scope(env_);
    for (auto ref : pool_) {
        napi_delete_reference(env_, ref);
    }
    for (auto& kv : in_use_) {
        napi_delete_reference(env_, kv.first);
    }
    pool_.clear();
    in_use_.clear();
}

Napi::Object TrackObjectPool::acquire() {
    Napi::EscapableHandleScope scope(env_);
    if (!pool_.empty()) {
        napi_ref ref = pool_.front();
        pool_.pop_front();
        in_use_[ref] = true;
        napi_value v;
        napi_get_reference_value(env_, ref, &v);
        Napi::Object obj = Napi::Object(env_, v);
        obj.Delete("modeSAddress");
        obj.Delete("latitude");
        obj.Delete("longitude");
        obj.Delete("flightLevel");
        obj.Delete("trackNumber");
        obj.Delete("timeOfDay");
        obj.Delete("groundSpeed");
        obj.Delete("trackAngle");
        obj.Delete("hasModeS");
        obj.Delete("hasPosition");
        obj.Delete("hasAltitude");
        obj.Delete("callsign");
        return scope.Escape(obj);
    }
    Napi::Object obj = Napi::Object::New(env_);
    napi_ref ref;
    napi_create_reference(env_, obj, 1, &ref);
    in_use_[ref] = true;
    return scope.Escape(obj);
}

void TrackObjectPool::release(Napi::Object obj) {
    Napi::HandleScope scope(env_);
    napi_ref ref;
    napi_create_reference(env_, obj, 1, &ref);
    in_use_[ref] = false;
    if (pool_.size() < 2048) {
        pool_.push_back(ref);
    } else {
        napi_delete_reference(env_, ref);
    }
}

void TrackObjectPool::reset() {
    Napi::HandleScope scope(env_);
    for (auto ref : pool_) {
        napi_delete_reference(env_, ref);
    }
    pool_.clear();
}

}

using namespace Napi;
using namespace asterix;

static std::shared_ptr<TrackObjectPool> g_pool;

static void fillTrackObject(Napi::Object& obj, const TrackPoint& t) {
    Napi::Env env = obj.Env();
    obj.Set("modeSAddress", Napi::Number::New(env, static_cast<double>(t.mode_s_address)));
    obj.Set("latitude", Napi::Number::New(env, t.latitude));
    obj.Set("longitude", Napi::Number::New(env, t.longitude));
    obj.Set("flightLevel", Napi::Number::New(env, t.altitude_fl));
    obj.Set("trackNumber", Napi::Number::New(env, static_cast<double>(t.track_number)));
    obj.Set("timeOfDay", Napi::Number::New(env, t.time_of_day));
    obj.Set("groundSpeed", Napi::Number::New(env, t.ground_speed));
    obj.Set("trackAngle", Napi::Number::New(env, t.track_angle));
    obj.Set("hasModeS", Napi::Boolean::New(env, t.has_mode_s));
    obj.Set("hasPosition", Napi::Boolean::New(env, t.has_position));
    obj.Set("hasAltitude", Napi::Boolean::New(env, t.has_altitude));
    obj.Set("callsign", Napi::String::New(env, t.callsign));
}

static void trackPointToBinary(const TrackPoint& t, TrackBinary* b) {
    std::memset(b, 0, sizeof(TrackBinary));
    b->mode_s_address = t.mode_s_address;
    b->track_number = t.track_number;
    if (std::isfinite(t.latitude)) {
        b->latitude_e7 = clampI32(static_cast<int32_t>(t.latitude * 10000000.0),
                                   -900000000, 900000000);
    } else {
        b->latitude_e7 = 0;
    }
    if (std::isfinite(t.longitude)) {
        b->longitude_e7 = clampI32(static_cast<int32_t>(t.longitude * 10000000.0),
                                    -1800000000, 1800000000);
    } else {
        b->longitude_e7 = 0;
    }
    if (std::isfinite(t.altitude_fl)) {
        b->altitude_fl_x100 = clampI32(static_cast<int32_t>(t.altitude_fl * 100.0),
                                       -5000, 70000);
    } else {
        b->altitude_fl_x100 = 0;
    }
    if (std::isfinite(t.ground_speed)) {
        b->ground_speed_x100 = clampI32(static_cast<int32_t>(t.ground_speed * 100.0),
                                         0, 200000);
    } else {
        b->ground_speed_x100 = 0;
    }
    if (std::isfinite(t.track_angle)) {
        while (t.track_angle < 0) {}
        b->track_angle_x100 = clampI32(static_cast<int32_t>(t.track_angle * 100.0),
                                        0, 36000);
    } else {
        b->track_angle_x100 = 0;
    }
    b->time_of_day_x128 = static_cast<uint32_t>(t.time_of_day * 128.0);
    uint8_t flags = 0;
    if (t.has_mode_s) flags |= TB_HAS_MODE_S;
    if (t.has_position) flags |= TB_HAS_POSITION;
    if (t.has_altitude) flags |= TB_HAS_ALTITUDE;
    if (t.ground_speed > 0) flags |= TB_HAS_SPEED;
    if (t.track_angle >= 0 && t.track_angle <= 360) flags |= TB_HAS_HEADING;
    if (!t.callsign.empty()) flags |= TB_HAS_CALLSIGN;
    b->flags = flags;
    for (size_t i = 0; i < 8 && i < t.callsign.size(); i++) {
        b->callsign[i] = static_cast<int8_t>(t.callsign[i]);
    }
}

Napi::Value DecodeAsterix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Buffer expected as first argument").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
    const uint8_t* data = buf.Data();
    size_t len = buf.Length();

    RadarSource radar{39.86, 116.47, 0, 0};
    if (info.Length() >= 2 && info[1].IsObject()) {
        Napi::Object opt = info[1].As<Napi::Object>();
        if (opt.Has("radarLat") && opt.Get("radarLat").IsNumber())
            radar.radar_lat = opt.Get("radarLat").As<Napi::Number>().DoubleValue();
        if (opt.Has("radarLon") && opt.Get("radarLon").IsNumber())
            radar.radar_lon = opt.Get("radarLon").As<Napi::Number>().DoubleValue();
        if (opt.Has("sac") && opt.Get("sac").IsNumber())
            radar.sac = static_cast<uint16_t>(opt.Get("sac").As<Napi::Number>().Uint32Value());
        if (opt.Has("sic") && opt.Get("sic").IsNumber())
            radar.sic = static_cast<uint16_t>(opt.Get("sic").As<Napi::Number>().Uint32Value());
    }

    if (len < 3) {
        return Napi::Array::New(env, 0);
    }

    uint8_t category = data[0];
    std::vector<TrackPoint> tracks;

    try {
        if (category == 48) {
            tracks = decodeCat048(data, len, radar);
        } else if (category == 62) {
            tracks = decodeCat062(data, len);
        }
    } catch (...) {
        tracks.clear();
    }

    if (!g_pool) {
        g_pool = std::make_shared<TrackObjectPool>(env);
    }

    Napi::Array arr = Napi::Array::New(env, tracks.size());
    for (size_t i = 0; i < tracks.size(); i++) {
        Napi::Object obj = g_pool->acquire();
        fillTrackObject(obj, tracks[i]);
        arr.Set(static_cast<uint32_t>(i), obj);
    }

    return arr;
}

Napi::Value DecodeAsterixBinary(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Buffer expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
    const uint8_t* data = buf.Data();
    size_t len = buf.Length();

    RadarSource radar{39.86, 116.47, 0, 0};
    if (info.Length() >= 2 && info[1].IsObject()) {
        Napi::Object opt = info[1].As<Napi::Object>();
        if (opt.Has("radarLat")) radar.radar_lat = opt.Get("radarLat").As<Napi::Number>().DoubleValue();
        if (opt.Has("radarLon")) radar.radar_lon = opt.Get("radarLon").As<Napi::Number>().DoubleValue();
        if (opt.Has("sac")) radar.sac = static_cast<uint16_t>(opt.Get("sac").As<Napi::Number>().Uint32Value());
        if (opt.Has("sic")) radar.sic = static_cast<uint16_t>(opt.Get("sic").As<Napi::Number>().Uint32Value());
    }

    std::vector<TrackPoint> tracks;
    if (len >= 3) {
        uint8_t category = data[0];
        try {
            if (category == 48) tracks = decodeCat048(data, len, radar);
            else if (category == 62) tracks = decodeCat062(data, len);
        } catch (...) {}
    }

    size_t count = tracks.size();
    size_t totalBytes = sizeof(uint32_t) + count * sizeof(TrackBinary);
    Napi::Buffer<uint8_t> outBuf = Napi::Buffer<uint8_t>::New(env, totalBytes);

    uint8_t* outPtr = outBuf.Data();
    *reinterpret_cast<uint32_t*>(outPtr) = static_cast<uint32_t>(count);
    outPtr += sizeof(uint32_t);

    for (size_t i = 0; i < count; i++) {
        TrackBinary* tb = reinterpret_cast<TrackBinary*>(outPtr);
        trackPointToBinary(tracks[i], tb);
        outPtr += sizeof(TrackBinary);
    }

    return outBuf;
}

Napi::Value ResetPool(const Napi::CallbackInfo& info) {
    if (g_pool) g_pool->reset();
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "decode"), Napi::Function::New(env, DecodeAsterix));
    exports.Set(Napi::String::New(env, "decodeBinary"), Napi::Function::New(env, DecodeAsterixBinary));
    exports.Set(Napi::String::New(env, "resetPool"), Napi::Function::New(env, ResetPool));
    exports.Set(Napi::String::New(env, "TRACK_BINARY_SIZE"), Napi::Number::New(env, static_cast<double>(sizeof(TrackBinary))));
    exports.Set(Napi::String::New(env, "TB_FLAGS_MODE_S"), Napi::Number::New(env, TB_HAS_MODE_S));
    exports.Set(Napi::String::New(env, "TB_FLAGS_POSITION"), Napi::Number::New(env, TB_HAS_POSITION));
    exports.Set(Napi::String::New(env, "TB_FLAGS_ALTITUDE"), Napi::Number::New(env, TB_HAS_ALTITUDE));
    exports.Set(Napi::String::New(env, "TB_FLAGS_SPEED"), Napi::Number::New(env, TB_HAS_SPEED));
    exports.Set(Napi::String::New(env, "TB_FLAGS_HEADING"), Napi::Number::New(env, TB_HAS_HEADING));
    exports.Set(Napi::String::New(env, "TB_FLAGS_CALLSIGN"), Napi::Number::New(env, TB_HAS_CALLSIGN));
    return exports;
}

NODE_API_MODULE(asterix_decoder, Init)
