#pragma once

#include <napi.h>
#include <cstdint>
#include <vector>
#include <string>
#include <cmath>
#include <unordered_map>
#include <deque>
#include <memory>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace asterix {

struct TrackPoint {
    double latitude;
    double longitude;
    double altitude_fl;
    uint32_t mode_s_address;
    uint32_t track_number;
    double time_of_day;
    bool has_mode_s;
    bool has_position;
    bool has_altitude;
    double ground_speed;
    double track_angle;
    std::string callsign;
};

#pragma pack(push, 1)
struct TrackBinary {
    uint32_t mode_s_address;
    uint32_t track_number;
    int32_t  latitude_e7;
    int32_t  longitude_e7;
    int32_t  altitude_fl_x100;
    int32_t  ground_speed_x100;
    int32_t  track_angle_x100;
    uint32_t time_of_day_x128;
    uint8_t  flags;
    int8_t   callsign[8];
};
#pragma pack(pop)

struct RadarSource {
    double radar_lat;
    double radar_lon;
    uint16_t sac;
    uint16_t sic;
};

enum TrackBinaryFlags : uint8_t {
    TB_HAS_MODE_S   = 0x01,
    TB_HAS_POSITION = 0x02,
    TB_HAS_ALTITUDE = 0x04,
    TB_HAS_SPEED    = 0x08,
    TB_HAS_HEADING  = 0x10,
    TB_HAS_CALLSIGN = 0x20
};

inline uint32_t grayToBinary14(uint32_t gray) {
    gray &= 0x3FFF;
    uint32_t bin = gray;
    bin ^= (gray >> 1);
    bin ^= (gray >> 2);
    bin ^= (gray >> 3);
    bin ^= (gray >> 4);
    bin ^= (gray >> 5);
    bin ^= (gray >> 6);
    bin ^= (gray >> 7);
    bin ^= (gray >> 8);
    bin ^= (gray >> 9);
    bin ^= (gray >> 10);
    bin ^= (gray >> 11);
    bin ^= (gray >> 12);
    bin ^= (gray >> 13);
    return bin & 0x3FFF;
}

inline int32_t decodeAltitudeGillhamFE(uint16_t alt_word) {
    const uint16_t MASK_D = 0x0010;
    const uint16_t MASK_A = 0x0888;
    const uint16_t MASK_B = 0x0444;
    const uint16_t MASK_C = 0x0222;
    const uint16_t FE_BIT  = 0x0040;

    if (!(alt_word & FE_BIT)) return -99999;

    uint32_t d1 = (alt_word & 0x0001) ? 1 : 0;
    uint32_t d2 = (alt_word & 0x0002) ? 1 : 0;
    uint32_t d4 = (alt_word & 0x0004) ? 1 : 0;

    uint32_t a1 = (alt_word & 0x0008) ? 1 : 0;
    uint32_t a2 = (alt_word & 0x0080) ? 1 : 0;
    uint32_t a4 = (alt_word & 0x0800) ? 1 : 0;

    uint32_t b1 = (alt_word & 0x0010) ? 1 : 0;
    uint32_t b2 = (alt_word & 0x0100) ? 1 : 0;
    uint32_t b4 = (alt_word & 0x1000) ? 1 : 0;

    uint32_t c1 = (alt_word & 0x0020) ? 1 : 0;
    uint32_t c2 = (alt_word & 0x0200) ? 1 : 0;
    uint32_t c4 = (alt_word & 0x2000) ? 1 : 0;

    uint32_t gray_500ft = (a1 << 0) | (a2 << 1) | (a4 << 2) |
                          (b1 << 3) | (b2 << 4) | (b4 << 5) |
                          (c1 << 6) | (c2 << 7) | (c4 << 8);
    uint32_t bin_500ft = grayToBinary14(gray_500ft << 5) >> 5;
    bin_500ft &= 0x1FF;

    uint32_t gray_100ft = (d1 << 0) | (d2 << 1) | (d4 << 2);
    uint32_t bin_100ft = grayToBinary14(gray_100ft << 11) >> 11;
    bin_100ft &= 0x7;

    if (bin_100ft == 5 || bin_100ft == 6 || bin_100ft == 7) return -99998;

    if (bin_500ft & 1) {
        if (bin_100ft == 0) bin_100ft = 4;
        else if (bin_100ft == 1) bin_100ft = 3;
        else if (bin_100ft == 3) bin_100ft = 1;
        else if (bin_100ft == 4) bin_100ft = 0;
    }

    int32_t total_500_units = static_cast<int32_t>(bin_500ft);
    int32_t feet = total_500_units * 500 + static_cast<int32_t>(bin_100ft) * 100 - 1200;

    if (feet < -1500) feet = -1200;
    if (feet > 65000) feet = 65000;

    return feet;
}

inline int32_t clampI32(int32_t v, int32_t lo, int32_t hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

class BitReader {
public:
    BitReader(const uint8_t* data, size_t len);
    uint64_t readBits(size_t n);
    uint32_t readU32(size_t n);
    int32_t readS32(size_t n);
    uint16_t readU16(size_t n);
    uint8_t  readU8(size_t n);
    uint16_t readU16BE();
    bool readBit();
    void skipBits(size_t n);
    size_t bitPos() const { return bit_pos_; }
    size_t bytePos() const { return byte_pos_; }
    bool eof() const { return byte_pos_ >= length_; }
    void alignToByte();

private:
    const uint8_t* data_;
    size_t length_;
    size_t byte_pos_;
    size_t bit_pos_;
};

std::vector<TrackPoint> decodeCat048(const uint8_t* data, size_t len, const RadarSource& radar);
std::vector<TrackPoint> decodeCat062(const uint8_t* data, size_t len);

double wgs84DistanceBearingToLat(double lat, double lon, double range_m, double bearing_deg, double& out_lat, double& out_lon);

class TrackObjectPool {
public:
    explicit TrackObjectPool(Napi::Env env);
    ~TrackObjectPool();
    Napi::Object acquire();
    void release(Napi::Object obj);
    void reset();

private:
    Napi::Env env_;
    std::deque<napi_ref> pool_;
    std::unordered_map<napi_ref, bool> in_use_;
};

}
