#include "asterix_decoder.h"
#include <napi.h>

namespace asterix {

BitReader::BitReader(const uint8_t* data, size_t len)
    : data_(data), length_(len), byte_pos_(0), bit_pos_(0) {}

uint64_t BitReader::readBits(size_t n) {
    uint64_t result = 0;
    for (size_t i = 0; i < n; i++) {
        result = (result << 1) | readBit();
    }
    return result;
}

uint32_t BitReader::readU32(size_t n) {
    return static_cast<uint32_t>(readBits(n));
}

int32_t BitReader::readS32(size_t n) {
    uint32_t val = readU32(n);
    if (val & (1u << (n - 1))) {
        val |= ~((1u << n) - 1);
    }
    return static_cast<int32_t>(val);
}

uint16_t BitReader::readU16(size_t n) {
    return static_cast<uint16_t>(readBits(n));
}

uint8_t BitReader::readU8(size_t n) {
    return static_cast<uint8_t>(readBits(n));
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
    for (size_t i = 0; i < n; i++) readBit();
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

}

using namespace Napi;
using namespace asterix;

static Napi::Array trackPointsToJs(const Napi::Env& env, const std::vector<TrackPoint>& tracks) {
    Napi::Array arr = Napi::Array::New(env, tracks.size());
    for (size_t i = 0; i < tracks.size(); i++) {
        const auto& t = tracks[i];
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("modeSAddress", Napi::Number::New(env, t.mode_s_address));
        obj.Set("latitude", Napi::Number::New(env, t.latitude));
        obj.Set("longitude", Napi::Number::New(env, t.longitude));
        obj.Set("flightLevel", Napi::Number::New(env, t.altitude_fl));
        obj.Set("trackNumber", Napi::Number::New(env, t.track_number));
        obj.Set("timeOfDay", Napi::Number::New(env, t.time_of_day));
        obj.Set("groundSpeed", Napi::Number::New(env, t.ground_speed));
        obj.Set("trackAngle", Napi::Number::New(env, t.track_angle));
        obj.Set("hasModeS", Napi::Boolean::New(env, t.has_mode_s));
        obj.Set("hasPosition", Napi::Boolean::New(env, t.has_position));
        obj.Set("hasAltitude", Napi::Boolean::New(env, t.has_altitude));
        obj.Set("callsign", Napi::String::New(env, t.callsign));
        arr.Set(static_cast<uint32_t>(i), obj);
    }
    return arr;
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
        } else {
            tracks = {};
        }
    } catch (...) {
        tracks = {};
    }

    return trackPointsToJs(env, tracks);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "decode"), Napi::Function::New(env, DecodeAsterix));
    return exports;
}

NODE_API_MODULE(asterix_decoder, Init)
