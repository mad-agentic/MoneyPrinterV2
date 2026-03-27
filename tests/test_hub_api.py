import requests

BASE_URL = "http://127.0.0.1:15001"

def test_api():
    print("Testing API Endpoints...")

    # 1. Test /system/status
    try:
        res = requests.get(f"{BASE_URL}/system/status")
        if res.status_code == 200:
            print("[PASS] GET /system/status")
        else:
            print(f"[FAIL] GET /system/status - Status Code: {res.status_code}")
    except Exception as e:
        print(f"[ERROR] GET /system/status - {e}")

    # 2. Test /accounts/youtube
    try:
        res = requests.get(f"{BASE_URL}/accounts/youtube")
        if res.status_code == 200:
            print("[PASS] GET /accounts/youtube")
            print(f"       Found {len(res.json())} accounts.")
        else:
            print(f"[FAIL] GET /accounts/youtube - Status Code: {res.status_code}")
    except Exception as e:
        print(f"[ERROR] GET /accounts/youtube - {e}")

    # 3. Test /accounts/twitter
    try:
        res = requests.get(f"{BASE_URL}/accounts/twitter")
        if res.status_code == 200:
            print("[PASS] GET /accounts/twitter")
            print(f"       Found {len(res.json())} accounts.")
        else:
            print(f"[FAIL] GET /accounts/twitter - Status Code: {res.status_code}")
    except Exception as e:
        print(f"[ERROR] GET /accounts/twitter - {e}")

if __name__ == "__main__":
    test_api()
